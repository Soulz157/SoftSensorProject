"""Error bodies must never echo a submitted credential.

The bug this file pins was real, not theoretical. Before
`main.redacted_validation_handler` existed:

    POST /v1/preprocess/materialize  {"pi": {"credentials": {..., "password": X}}}
    -> 422 {"detail":[{..., "input":{"credentials":{..., "password": X}}}]}

FastAPI's default handler returns `exc.errors()` verbatim, and every pydantic v2
error carries the value that failed under `input`. Every credential-bearing
endpoint here takes a body holding a DECRYPTED password, and
`apps/backend/src/lib/python-client.ts` relays an upstream 4xx `detail` onward
as an AppException message — so the password reaches the browser.

The sentinel below is synthetic. Every request is rejected during validation, so
nothing is ever dialled.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app

SENTINEL = "pytest-sentinel-password-do-not-log"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def pi_credentials(complete: bool = True) -> dict:
    """`complete=False` omits `pi_server`, so the body fails validation.

    That distinction is load-bearing: a body that VALIDATES gets past the
    handler and the endpoint tries to dial the host, which is a different code
    path and does not test redaction at all.
    """
    credentials = {
        "api_server": "pi.example",
        "pi_server": "PISRV",
        "user": "synthetic",
        "password": SENTINEL,
    }
    if not complete:
        del credentials["pi_server"]
    return credentials


def sql_credentials() -> dict:
    return {
        "driver": "postgres",
        "host": "db.example",
        "port": 5432,
        "database": "d",
        "user": "synthetic",
        "password": SENTINEL,
    }


def materialize_body() -> dict:
    """Valid `target_key`, `pi` missing tag_list/start_time/end_time."""
    return {"target_key": "ds-1/v1.parquet", "pi": {"credentials": pi_credentials()}}


# Each case FAILS VALIDATION while carrying a credential — the exact shape that
# used to echo it back.
LEAK_CASES = [
    ("/v1/preprocess/materialize", materialize_body()),
    # The pre-existing routes carry the same risk. The handler is app-wide, and
    # these prove that rather than assuming it.
    # `pi/tags` needs only `credentials`, so an INCOMPLETE credential block is
    # what makes it fail validation rather than dial the host.
    ("/v1/data-sources/pi/tags", {"credentials": pi_credentials(complete=False)}),
    ("/v1/data-sources/pi/fetch", {"credentials": pi_credentials()}),
    ("/v1/data-sources/sql/query", {"credentials": sql_credentials()}),
]


@pytest.mark.parametrize("path,body", LEAK_CASES, ids=[case[0] for case in LEAK_CASES])
def test_validation_errors_do_not_echo_credentials(
    client: TestClient, path: str, body: dict
) -> None:
    response = client.post(path, json=body)

    assert response.status_code == 422, (
        f"{path} should reject this body during validation; another status "
        "means the case no longer exercises the redaction path."
    )
    assert SENTINEL not in response.text


def test_the_error_is_still_actionable(client: TestClient) -> None:
    """Redaction that dropped `loc` too would be safe and useless.

    A caller must be able to tell WHICH field is wrong, or fixing a request
    becomes guesswork.
    """
    detail = client.post(
        "/v1/preprocess/materialize", json=materialize_body()
    ).json()["detail"]

    assert detail, "the response must still say what failed"
    first = detail[0]
    assert set(first) == {"type", "loc", "msg"}
    assert first["loc"][:2] == ["body", "pi"]
    assert first["msg"]


def test_the_handler_does_not_reject_a_well_formed_body(client: TestClient) -> None:
    """It must not turn structurally valid requests into 422s.

    This body passes schema validation and fails later, on storage. A 422 here
    would come from the ROUTER's ObjectStoreError branch — whose message names
    the missing key — never from the schema.
    """
    response = client.post(
        "/v1/preprocess/rows",
        json={"source_key": "definitely-missing/v1.parquet", "offset": 0, "limit": 10},
    )

    assert response.status_code in (422, 502)
    if response.status_code == 422:
        assert "definitely-missing" in response.text
