#!/usr/bin/env python3
"""MODEL-FLOW-009-T04 — one real end-to-end LSTM training run, driven over
HTTP against a REAL running stack (backend :4000, python :8000, Postgres,
and a real Docker training container running scgc/soft-sensor-trainer:1.0.4).

WRITES TO THE DEV DATABASE — a real ModelDraft and a real ModelTrainingRun.
Nothing is deleted; the draft is left ACTIVE for inspection.

Auth/psql/API helper pattern is DELIBERATELY the same as
scripts/verify/model-flow-008-lifecycle.py beside this file (HS256 token
minted from JWT_ACCESS_SECRET for an existing seeded user, same reasoning
for not using register+login: a fresh user has no workspace/dataset).

Scope: proves the pipeline this task built actually runs — windowing,
torch fit, predictions, loss history, and the widened splitSpec contract —
through the REAL API and a REAL container, not just unit tests against
pure functions. Does not drive Save Model; that boundary is already
covered end-to-end by MODEL-FLOW-008's script and is unrelated to what
T04 adds.

Usage:
    apps/python/.venv/bin/python scripts/verify/model-flow-009-t04-lstm.py

Requires: backend on :4000 (started via `dotenvx run -- pnpm --filter
backend dev`, NOT bare `pnpm --filter backend dev` — JWT_ACCESS_SECRET is
only injected through dotenvx), Postgres reachable via `docker exec
softsensorproject-db-1 psql`, Docker daemon reachable, trainer image
scgc/soft-sensor-trainer:1.0.4 built and tagged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests

_REPO_ROOT = Path(__file__).resolve().parents[2]

BACKEND = "http://localhost:4000/api/v1"
DB_CONTAINER = "softsensorproject-db-1"
DB_USER = "root"
DB_NAME = "soft_sensor_db"

# Real lstm fit on CPU is slower than sklearn's 1-3s — the resource
# benchmark (train.py's LSTM_MAX_TRAIN_WINDOWS comment) measured ~0.32ms
# per window per epoch at hidden_size=64. A generous ceiling, not a tuned
# one: 5 minutes total, polled every 3s.
POLL_INTERVAL_S = 3
POLL_MAX_ATTEMPTS = 100

TERMINAL_RUN_STATUSES = {"SUCCEEDED", "FAILED", "CANCELED"}


class VerificationFailure(RuntimeError):
    pass


def psql_rows(sql: str) -> list[list[str]]:
    result = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    out = result.stdout.strip()
    if not out:
        return []
    return [line.split("|") for line in out.splitlines()]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint_access_token(secret: str, payload: dict[str, Any], ttl_seconds: int = 900) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    body = {**payload, "iat": now, "exp": now + ttl_seconds}
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}." \
                    f"{_b64url(json.dumps(body, separators=(',', ':')).encode())}"
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"


def read_env(key: str) -> str:
    for line in (_REPO_ROOT / ".env").read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"')
    raise VerificationFailure(f"{key} not found in .env")


class Api:
    def __init__(self, token: str) -> None:
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"
        self.session.headers["Content-Type"] = "application/json"

    def get(self, path: str) -> dict[str, Any]:
        r = self.session.get(f"{BACKEND}{path}", timeout=15)
        r.raise_for_status()
        return r.json()

    def patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        r = self.session.patch(f"{BACKEND}{path}", json=body, timeout=15)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, body: dict[str, Any] | None = None, *, expect: int | None = None) -> tuple[int, dict[str, Any]]:
        r = self.session.post(f"{BACKEND}{path}", json=body or {}, timeout=15)
        if expect is not None and r.status_code != expect:
            raise VerificationFailure(
                f"POST {path} -> {r.status_code}, expected {expect}: {r.text[:800]}"
            )
        return r.status_code, (r.json() if r.content else {})


def assert_eq(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise VerificationFailure(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(label: str, cond: bool) -> None:
    if not cond:
        raise VerificationFailure(label)


def step(label: str) -> None:
    print(f"\n{'=' * 70}\n{label}\n{'=' * 70}")


def poll_run(api: Api, draft_id: str, run_id: str) -> dict[str, Any]:
    for attempt in range(POLL_MAX_ATTEMPTS):
        run = api.get(f"/authorized/model-drafts/{draft_id}/runs/{run_id}")["data"]
        if run["status"] in TERMINAL_RUN_STATUSES:
            return run
        if attempt % 5 == 0:
            print(f"  ...polling ({attempt * POLL_INTERVAL_S}s elapsed), status={run['status']}")
        time.sleep(POLL_INTERVAL_S)
    raise VerificationFailure(
        f"run {run_id} did not reach a terminal status within "
        f"{POLL_MAX_ATTEMPTS * POLL_INTERVAL_S}s"
    )


def main() -> int:
    started = time.time()
    run_suffix = int(started)

    step("STAGE 0 — Preflight")
    try:
        requests.post(f"{BACKEND}/public/auth/login", json={}, timeout=3)
    except requests.RequestException as exc:
        raise VerificationFailure(f"Backend unreachable on :4000 — {exc}") from exc
    print("backend :4000 reachable")

    secret = read_env("JWT_ACCESS_SECRET")
    user_row = psql_rows(
        "SELECT id, email, \"firstName\", \"lastName\", role FROM \"User\" "
        "WHERE email = 'phoorich.oscar@gmail.com' LIMIT 1;"
    )
    assert_true("Seed user must exist", bool(user_row))
    user_id, email, first_name, last_name, role = user_row[0]
    token = mint_access_token(secret, {
        "id": user_id, "email": email, "firstName": first_name,
        "lastName": last_name, "role": role,
    })
    api = Api(token)
    print(f"minted access token for {email} ({user_id})")

    ws_row = psql_rows(
        f"SELECT id FROM \"Workspace\" WHERE \"ownerId\" = '{user_id}' LIMIT 1;"
    )
    assert_true("A workspace owned by the seed user must exist", bool(ws_row))
    workspace_id = ws_row[0][0]

    # Chosen over the other available FINAL artifacts: 15,441 rows is
    # comfortably above the sequence_length=24 windowing minimum and the
    # 30-window floor build_windows enforces, with a wide margin.
    artifact_row = psql_rows(
        "SELECT a.id, a.\"datasetId\", a.\"rowCount\" FROM \"DatasetArtifact\" a "
        "JOIN \"Dataset\" d ON d.id = a.\"datasetId\" "
        "WHERE a.type = 'FINAL' AND a.checksum IS NOT NULL AND a.checksum != '' "
        f"AND d.\"workspaceId\" = '{workspace_id}' AND a.\"rowCount\" >= 1000 "
        "ORDER BY a.\"rowCount\" DESC LIMIT 1;"
    )
    assert_true("A FINAL artifact with >=1000 rows must exist", bool(artifact_row))
    gold_artifact_id, dataset_id, row_count = artifact_row[0]
    print(f"gold artifact: {gold_artifact_id} (dataset {dataset_id}, {row_count} rows)")

    node_row = psql_rows(
        f"SELECT id FROM \"Nodes\" WHERE \"workspaceId\" = '{workspace_id}' LIMIT 1;"
    )
    assert_true("A Node must exist in the workspace", bool(node_row))
    node_id = node_row[0][0]

    target_row = psql_rows(
        f"SELECT DISTINCT \"targetY\" FROM \"ModelTrainingRun\" WHERE \"datasetId\" = '{dataset_id}' LIMIT 1;"
    )
    assert_true("A known-valid targetY for this dataset must exist from a prior run", bool(target_row))
    target_y = target_row[0][0]
    print(f"targetY: {target_y}")

    # ── Stage 1: create draft ───────────────────────────────────────────
    step("STAGE 1 — create ModelDraft")
    status, res = api.post("/authorized/model-drafts", {
        "workspaceId": workspace_id,
        "name": f"MODEL-FLOW-009-T04 lstm live run {run_suffix}",
        "nodeId": node_id,
        "datasetId": dataset_id,
    }, expect=201)
    draft_id = res["data"]["id"]
    print(f"created ModelDraft {draft_id}")

    # ── Stage 2: configure lstm ─────────────────────────────────────────
    step("STAGE 2 — PATCH draft with algorithm=lstm")
    hyperparameters = {
        "sequence_length": 24,
        "hidden_size": 64,
        "epochs": 15,
        "batch_size": 64,
    }
    api.patch(f"/authorized/model-drafts/{draft_id}", {
        "targetY": target_y, "algorithm": "lstm",
        "hyperparameters": hyperparameters, "splitRatio": 0.8,
    })
    print(f"draft PATCHed: algorithm=lstm, hyperparameters={hyperparameters}")

    # ── Stage 3: launch a real run ──────────────────────────────────────
    step("STAGE 3 — POST a real lstm training run")
    status, res = api.post(f"/authorized/model-drafts/{draft_id}/runs", {
        "goldArtifactId": gold_artifact_id, "targetY": target_y,
        "algorithm": "lstm", "hyperparameters": hyperparameters,
        "trainTestSplit": 0.8,
    }, expect=201)
    run_id = res["data"]["id"]
    launch_elapsed = time.time() - started
    print(f"run {run_id} created ({res['data']['status']}) in {launch_elapsed:.2f}s total "
          f"— non-blocking, same as every other algorithm")

    fit_started = time.time()
    run = poll_run(api, draft_id, run_id)
    fit_elapsed = time.time() - fit_started

    if run["status"] != "SUCCEEDED":
        raise VerificationFailure(
            f"run {run_id} ended {run['status']}: {run.get('failureReason')}"
        )
    assert_true("run has modelKey", run["modelKey"] is not None)
    print(f"PASS — run {run_id} SUCCEEDED in {fit_elapsed:.1f}s, modelKey={run['modelKey']}")

    # ── Stage 4: splitSpec contract (decision 6/8) ──────────────────────
    step("STAGE 4 — windowed splitSpec accepted and persisted")
    split_spec = run["splitSpec"]
    print(f"splitSpec: {split_spec}")
    assert_eq("splitSpec.method", split_spec["method"], "chronological_windowed")
    assert_eq("splitSpec.sequence_length", split_spec["sequence_length"], 24)
    assert_true("splitSpec.train_rows is a window count > 0", split_spec["train_rows"] > 0)
    assert_true("splitSpec.test_rows is a window count > 0", split_spec["test_rows"] > 0)
    assert_eq("splitSpec.source_rows", split_spec["source_rows"], int(row_count))
    print(f"PASS — chronological_windowed accepted by RunCompleteSchema's discriminated "
          f"union and persisted: {split_spec['train_rows']} train / "
          f"{split_spec['test_rows']} test windows")

    print(f"metrics: r2={run['metrics']['r2']:.4f} rmse={run['metrics']['rmse']:.4f} "
          f"(train_rows/test_rows here are WINDOW counts, decision 8)")

    # ── Stage 5: predictions (windowed source, decision 8) ──────────────
    step("STAGE 5 — predictions for the real windowed test split")
    predictions = api.get(
        f"/authorized/model-drafts/{draft_id}/runs/{run_id}/predictions"
    )["data"]
    n_points = len(predictions["points"])
    assert_true("predictions has points", n_points > 0)
    assert_eq("predictions row_count matches splitSpec.test_rows",
              predictions["row_count"], split_spec["test_rows"])
    print(f"PASS — {n_points} real prediction points, row_count matches the "
          f"windowed test_rows exactly (ts_test/y_test source, not re-derived)")

    # ── Stage 6: loss history was written (SequenceRegressor.train_loss_) ──
    # Real finding this pass: there is NO GET .../runs/:runId/loss-history
    # route for a plain single-run — getRunLossHistory (python-preprocess-
    # client.ts) is only ever called from model-candidate-job.authorized.
    # service.ts, embedding lossHistory into a CANDIDATE's own response.
    # This is a PRE-EXISTING gap affecting every algorithm that produces a
    # loss curve (mlp/hgb/lightgbm/xgboost too), not something lstm/gru
    # introduces — out of this task's scope to fix. What this stage CAN
    # verify without that route: the run row itself carries a
    # lossHistoryKey, proving extract_loss_history's new lstm branch ran
    # and loss_history.json was uploaded — read the object directly via
    # the same ObjectStore the -008 script already imports for its own
    # artifact check, rather than a route that does not exist.
    step("STAGE 6 — loss history object was written (no direct-run read route exists)")
    loss_history_key = run.get("lossHistoryKey")
    assert_true("run has a lossHistoryKey", bool(loss_history_key))
    print(f"run.lossHistoryKey = {loss_history_key}")

    sys.path.insert(0, str(_REPO_ROOT / "apps" / "python"))
    from intergrations.object_store import ObjectStore  # noqa: E402

    store = ObjectStore()
    assert_true(f"loss_history.json exists in MinIO ({loss_history_key})",
                store.exists(loss_history_key))
    loss_history = store.get_json(loss_history_key)
    print(f"loss_history: algorithm={loss_history['algorithm']} metric={loss_history['metric']} "
          f"train points={len(loss_history['series']['train'])}")
    assert_eq("loss_history.algorithm", loss_history["algorithm"], "lstm")
    assert_eq("loss_history.metric", loss_history["metric"], "loss")
    assert_eq("train series length == epochs", len(loss_history["series"]["train"]),
              hyperparameters["epochs"])
    assert_true("validation series present", "validation" in loss_history["series"])
    assert_true(
        "training loss actually decreased (real fit, not a no-op)",
        loss_history["series"]["train"][-1] < loss_history["series"]["train"][0],
    )
    print(f"PASS — {hyperparameters['epochs']} real epoch losses recorded, "
          f"train loss {loss_history['series']['train'][0]:.4f} -> "
          f"{loss_history['series']['train'][-1]:.4f} (decreased — genuinely fit, not degenerate)")

    total_elapsed = time.time() - started
    print(f"\n{'=' * 70}\nALL STAGES PASSED in {total_elapsed:.1f}s (fit itself: {fit_elapsed:.1f}s)\n{'=' * 70}")
    print(f"draft_id={draft_id}")
    print(f"run_id={run_id}")
    print("Draft left ACTIVE, not cleaned up — this script has no --cleanup flag.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VerificationFailure as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
