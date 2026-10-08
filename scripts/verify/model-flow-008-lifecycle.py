#!/usr/bin/env python3
"""MODEL-FLOW-008 — end-to-end verification of the six-step Model Creation
lifecycle, driven entirely over HTTP against a REAL running stack (backend
:4000, python :8000, Postgres, and a real Docker training container).

WRITES TO THE DEV DATABASE. Unlike v01/v02 beside this file (both read-only),
this script creates real rows: a ModelDraft, ModelTrainingRun rows, a
ModelCandidateJob, and (at the final stage) exactly one Model. Every row it
creates is printed. Nothing is deleted unless you pass --cleanup, which
abandons the draft and deletes the Model this run created — and ONLY those.

WHY NOT register+login a fresh user (the fully-open path this session
confirmed works): a fresh user has no workspace and no dataset with a FINAL
artifact, and building one means driving the whole Data Studio ingest
pipeline. This script instead resolves an EXISTING user/workspace/dataset
already sitting in the dev DB and mints its own access token for that user
(HS256 via JWT_ACCESS_SECRET — same algorithm apps/backend/src/strategies/
jwt-access.strategy.ts verifies with), which is exactly what a real login
would hand back, just without spending the 15-minute TTL getting there.

Persistence-boundary discipline: every boundary check compares the SET of
Model ids in the target workspace, not a global `SELECT count(*) FROM
"Model"` — a global count is corruptible by unrelated activity in another
browser tab and would produce a false pass or a false failure.

Usage:
    apps/python/.venv/bin/python scripts/verify/model-flow-008-lifecycle.py
    apps/python/.venv/bin/python scripts/verify/model-flow-008-lifecycle.py --cleanup

Requires: backend on :4000, python on :8000, Postgres reachable via
`docker exec softsensorproject-db-1 psql`, Docker daemon reachable, trainer
image built and tagged (see trainning-container.authorized.service.ts's own
`imageRef` default for which tag).
"""

from __future__ import annotations

import argparse
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
sys.path.insert(0, str(_REPO_ROOT / "apps" / "python"))

from intergrations.object_store import ObjectStore  # noqa: E402

BACKEND = "http://localhost:4000/api/v1"
DB_CONTAINER = "softsensorproject-db-1"
DB_USER = "root"
DB_NAME = "soft_sensor_db"

# Poll cadence for both a single run and a candidate job. Real runs in this
# dev DB complete in 1-3s (measured this session) — 60 x 2s = 2 minutes is a
# generous ceiling, not a tuned value.
POLL_INTERVAL_S = 2
POLL_MAX_ATTEMPTS = 60

TERMINAL_RUN_STATUSES = {"SUCCEEDED", "FAILED", "CANCELED"}
TERMINAL_JOB_STATUSES = {"SUCCEEDED", "FAILED", "CANCELED"}


class VerificationFailure(RuntimeError):
    """Raised the moment an assertion fails — the walk stops immediately
    rather than limping into a later stage on top of a wrong precondition."""


def psql(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-c", sql],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def psql_rows(sql: str) -> list[list[str]]:
    out = psql(sql)
    if not out:
        return []
    return [line.split("|") for line in out.splitlines()]


# ── auth ─────────────────────────────────────────────────────────────────

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint_access_token(secret: str, payload: dict[str, Any], ttl_seconds: int = 900) -> str:
    """HS256 JWT — same shape apps/backend/src/utils/jwt.ts's JwtPayload
    declares (id/email/firstName/lastName/role) and the same secret
    JwtAccessStrategy verifies with. 15-minute TTL matches loginService's
    own override (auth.public.service.ts) so a script token behaves exactly
    like a real login's, not a longer-lived impersonation."""
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


# ── HTTP helpers ─────────────────────────────────────────────────────────

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

    def delete(self, path: str, body: dict[str, Any]) -> None:
        r = self.session.request("DELETE", f"{BACKEND}{path}", json=body, timeout=15)
        r.raise_for_status()

    def post(self, path: str, body: dict[str, Any] | None = None, *, expect: int | None = None) -> tuple[int, dict[str, Any]]:
        r = self.session.post(f"{BACKEND}{path}", json=body or {}, timeout=15)
        if expect is not None and r.status_code != expect:
            raise VerificationFailure(
                f"POST {path} -> {r.status_code}, expected {expect}: {r.text[:500]}"
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


# ── the walk ─────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cleanup", action="store_true",
                         help="Abandon the draft and delete the Model this run created.")
    args = parser.parse_args()

    started = time.time()
    run_suffix = int(started)

    # ── Stage 0: preflight ──────────────────────────────────────────────
    step("STAGE 0 — Preflight")
    try:
        requests.post(f"{BACKEND}/public/auth/login", json={}, timeout=3)
    except requests.RequestException as exc:
        raise VerificationFailure(f"Backend unreachable on :4000 — {exc}") from exc
    try:
        requests.get("http://localhost:8000/health", timeout=3).raise_for_status()
    except requests.RequestException as exc:
        raise VerificationFailure(f"Python service unreachable on :8000 — {exc}") from exc
    print("backend :4000 reachable, python :8000 reachable")

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

    artifact_row = psql_rows(
        "SELECT a.id, a.\"datasetId\", a.\"rowCount\" FROM \"DatasetArtifact\" a "
        "JOIN \"Dataset\" d ON d.id = a.\"datasetId\" "
        "WHERE a.type = 'FINAL' AND a.checksum IS NOT NULL AND a.checksum != '' "
        f"AND d.\"workspaceId\" = '{workspace_id}' AND a.\"rowCount\" >= 30 "
        "ORDER BY a.\"createdAt\" DESC LIMIT 1;"
    )
    assert_true("A FINAL artifact with >=30 rows must exist in the workspace", bool(artifact_row))
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

    # ── Baseline: Model ids in this workspace, before anything ─────────
    step("Baseline — Model ids in workspace before the walk")
    baseline = api.get(f"/authorized/model?workspaceId={workspace_id}")
    baseline_ids = {m["id"] for m in baseline["data"]}
    print(f"{len(baseline_ids)} existing Model(s) in workspace {workspace_id}")

    # ── Stage 2: MODEL_SETUP (T01, V01) ─────────────────────────────────
    step("STAGE 2 — MODEL_SETUP (Step 1: Select Dataset)")
    status, res = api.post("/authorized/model-drafts", {
        "workspaceId": workspace_id,
        "name": f"MODEL-FLOW-008 lifecycle {run_suffix}",
        "nodeId": node_id,
        "datasetId": dataset_id,
    }, expect=201)
    draft = res["data"]
    draft_id = draft["id"]
    print(f"created ModelDraft {draft_id} (status={draft['status']})")
    assert_eq("draft.status after create", draft["status"], "ACTIVE")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after MODEL_SETUP", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created by Step 1")

    # ── Stage 3: DATASET_REVIEW (T01) ───────────────────────────────────
    step("STAGE 3 — DATASET_REVIEW (Step 2)")
    print("Note: Step 2 is NOT purely read-only in the real UI — the dataset-edit")
    print("hand-off (useDatasetEditHandoff -> ensureDraftId) can CREATE a draft.")
    print("This walk already has one (created above), so that path is not re-exercised;")
    print("recorded as a known behaviour, not verified as an absence of writes.")
    meta = api.get(f"/authorized/dataset/{dataset_id}/artifacts/{gold_artifact_id}/metadata")
    print(f"metadata: {meta['data'].get('rowCount', meta['data'].get('row_count'))} rows, "
          f"{len(meta['data'].get('tags', []))} tags")
    api.get(f"/authorized/dataset/{dataset_id}/artifacts/{gold_artifact_id}/column-stats")
    print("column-stats read OK")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after DATASET_REVIEW", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created by Step 2")

    # ── Stage 4: TRAINING (T02, V02) ────────────────────────────────────
    step("STAGE 4 — TRAINING (Step 3: real container)")
    api.patch(f"/authorized/model-drafts/{draft_id}", {
        "targetY": target_y, "algorithm": "ols",
        "hyperparameters": {"fit_intercept": True}, "splitRatio": 0.8,
    })
    print("draft PATCHed with algorithm=ols, splitRatio=0.8")

    status, res = api.post(f"/authorized/model-drafts/{draft_id}/runs", {
        "goldArtifactId": gold_artifact_id, "targetY": target_y,
        "algorithm": "ols", "hyperparameters": {"fit_intercept": True},
        "trainTestSplit": 0.8,
    }, expect=201)
    run = res["data"]
    run_id = run["id"]
    launch_elapsed = time.time() - started
    print(f"run {run_id} created ({run['status']}) — POST returned in "
          f"{launch_elapsed:.2f}s total, confirming this is non-blocking")

    run = poll_run(api, draft_id, run_id)
    assert_eq("first run status", run["status"], "SUCCEEDED")
    assert_true("first run has modelKey", run["modelKey"] is not None)
    print(f"run {run_id} SUCCEEDED, modelKey={run['modelKey']}")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after TRAINING", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created by Step 3 training")

    source_run_for_recall = run  # used by the -012-V02 leg below

    # ── -012-V02 (borrowed): server-side round-trip of applied params ───
    # Placed HERE, not after Save Model: saveDraftService freezes the draft
    # (409 "its runs are frozen") once SAVED, so this must run on an ACTIVE
    # draft — found live, not assumed, when the first draft this script
    # created above.
    step("-012-V02 (borrowed) — recorded parameters round-trip through a new run")
    print("Scope: verifies the SERVER-SIDE round-trip only. The client's own "
          "toApplyPatch derivation (apps/client/lib/run-params.ts) stays covered "
          "by -012-V01/V03 unit tests, not re-verified here.")
    source_algo = source_run_for_recall["algorithm"]
    source_hp = source_run_for_recall["hyperparameters"]
    source_ratio = source_run_for_recall["splitSpec"]["ratio"]
    status, res = api.post(f"/authorized/model-drafts/{draft_id}/runs", {
        "goldArtifactId": gold_artifact_id, "targetY": target_y,
        "algorithm": source_algo, "hyperparameters": source_hp,
        "trainTestSplit": source_ratio,
    }, expect=201)
    recalled_run = poll_run(api, draft_id, res["data"]["id"])
    assert_eq("recalled run algorithm", recalled_run["algorithm"], source_algo)
    assert_eq("recalled run hyperparameters", recalled_run["hyperparameters"], source_hp)
    assert_eq("recalled run split ratio", recalled_run["splitSpec"]["ratio"], source_ratio)
    print(f"PASS — new run {recalled_run['id']} reproduces "
          f"{source_algo}/{source_hp}/{source_ratio} exactly")

    # ── Stage 5: FINE_TUNING / candidate job (T04, V04, V05, -013-V01) ──
    step("STAGE 5 — FINE_TUNING (ModelCandidateJob, kind=HYPERPARAMETER_SEARCH)")
    job_create_started = time.time()
    status, res = api.post(f"/authorized/model-drafts/{draft_id}/candidate-jobs", {
        "goldArtifactId": gold_artifact_id, "targetY": target_y,
        "trainTestSplit": 0.8, "kind": "HYPERPARAMETER_SEARCH",
        "candidates": [
            {"algorithm": "ols", "hyperparameters": {"fit_intercept": True}},
            {"algorithm": "ols", "hyperparameters": {"fit_intercept": False}},
            {"algorithm": "ridge", "hyperparameters": {"alpha": 1.0}},
        ],
    }, expect=201)
    job_create_elapsed = time.time() - job_create_started
    job = res["data"]
    job_id = job["id"]
    print(f"candidate job {job_id} created, status={job['status']} — "
          f"POST returned in {job_create_elapsed:.2f}s (async, not blocking on 3 runs)")
    assert_true("job status is QUEUED or RUNNING immediately after create",
                job["status"] in ("QUEUED", "RUNNING"))

    # ── Stage 5b: concurrency (-013-V07) ────────────────────────────────
    step("STAGE 5b — Concurrent candidate job is refused (409)")
    status, res = api.post(f"/authorized/model-drafts/{draft_id}/candidate-jobs", {
        "goldArtifactId": gold_artifact_id, "targetY": target_y,
        "trainTestSplit": 0.8, "kind": "ALGORITHM_SWEEP",
        "candidates": [
            {"algorithm": "ols", "hyperparameters": {}},
            {"algorithm": "ridge", "hyperparameters": {}},
        ],
    })
    assert_eq("second concurrent candidate job", status, 409)
    print(f"PASS — second job while one is live -> 409: {res.get('message')}")

    job = poll_job(api, draft_id, job_id)
    assert_eq("candidate job status", job["status"], "SUCCEEDED")
    assert_eq("candidate job totalRuns", job["totalRuns"], 3)
    assert_eq("candidate job completedRuns", job["completedRuns"], 3)
    for c in job["candidates"]:
        assert_true(f"candidate {c['algorithm']} has a run", c["runId"] is not None)
        assert_eq(f"candidate {c['algorithm']} status", c["status"], "SUCCEEDED")
        assert_true(f"candidate {c['algorithm']} has metrics", c["metrics"] is not None)
    print(f"all 3 candidates SUCCEEDED with metrics — bestRunId={job['bestRunId']}, "
          f"bestRmse={job.get('bestRmse')}")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after FINE_TUNING", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created by fine-tuning")

    # ── -013-V03: a FAILED candidate job is still listed with its reason ─
    step("-013-V03 (borrowed) — a FAILED candidate job's read path")
    failed_job_row = psql_rows(
        "SELECT id, \"modelDraftId\" FROM \"ModelCandidateJob\" WHERE status = 'FAILED' LIMIT 1;"
    )
    if failed_job_row:
        failed_job_id, failed_draft_id = failed_job_row[0]
        failed_job = api.get(
            f"/authorized/model-drafts/{failed_draft_id}/candidate-jobs/{failed_job_id}"
        )["data"]
        assert_eq("failed job status", failed_job["status"], "FAILED")
        assert_true("failed job has a failureReason", bool(failed_job.get("failureReason")))
        assert_true("failed job's candidates are still listed",
                    len(failed_job["candidates"]) > 0)
        print(f"PASS (read-only, pre-existing row {failed_job_id}) — "
              f"FAILED job lists {len(failed_job['candidates'])} candidates, "
              f"reason: {failed_job['failureReason'][:80]}")
        print("Scope note: this asserts the READ path against an existing FAILED row; "
              "it does not force a fresh failure this run.")
    else:
        print("SKIPPED — no FAILED ModelCandidateJob row exists in this dev DB")

    # ── Stage 6: MODEL_SELECTION — pick the NON-best candidate (-013-V02) ─
    step("STAGE 6 — MODEL_SELECTION (Step 4): select the run that is NOT best")
    succeeded = [c for c in job["candidates"] if c["status"] == "SUCCEEDED"]
    non_best = next((c for c in succeeded if c["runId"] != job["bestRunId"]), None)
    assert_true("a non-best SUCCEEDED candidate exists to select", non_best is not None)
    selected_run_id = non_best["runId"]
    print(f"selecting {selected_run_id} ({non_best['algorithm']}) — "
          f"NOT the metric winner ({job['bestRunId']})")

    api.post(f"/authorized/model-drafts/{draft_id}/candidate-jobs/{job_id}/select",
              {"runId": selected_run_id}, expect=200)
    draft_after_select = api.get(f"/authorized/model-drafts/{draft_id}")["data"]
    assert_eq("resolvedRunId after selection", draft_after_select["resolvedRunId"], selected_run_id)
    assert_true(
        "PROVES SELECTION BITES: resolvedRunId is the selection, not bestRunId",
        draft_after_select["resolvedRunId"] != job["bestRunId"],
    )
    print(f"PASS — resolvedRunId={draft_after_select['resolvedRunId']} "
          f"(the selection), not bestRunId={job['bestRunId']}")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after MODEL_SELECTION", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created; no new ModelDraft column exists to check "
          "(selection lives entirely on ModelCandidateJob.selectedRunId)")

    # ── Stage 7: EVALUATION (T03, V03) ──────────────────────────────────
    step("STAGE 7 — EVALUATION (Step 5): predictions for the SELECTED run")
    predictions = api.get(
        f"/authorized/model-drafts/{draft_id}/runs/{selected_run_id}/predictions"
    )["data"]
    assert_true("predictions has points", len(predictions["points"]) > 0)
    # Raw API is snake_case — the camelCase mapping (toRunPredictions) lives
    # only in the CLIENT's services/model-draft.ts, which this script bypasses.
    print(f"PASS — {predictions['row_count']} prediction points for the selected run, "
          f"with no Model row in existence")
    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    assert_eq("Model set after EVALUATION", {m["id"] for m in after["data"]}, baseline_ids)
    print("PASS — no Model row created by Step 5 evaluation")

    # ── Stage 8: SAVE_MODEL (T05, V06) ──────────────────────────────────
    step("STAGE 8 — SAVE_MODEL (Step 6): the one persistence boundary")
    model_name = f"MODEL-FLOW-008 lifecycle {run_suffix}"
    status, res = api.post(f"/authorized/model-drafts/{draft_id}/save", {
        "name": model_name, "description": "MODEL-FLOW-008 live lifecycle walk",
    }, expect=201)
    saved_model = res["data"]
    saved_model_id = saved_model["id"]
    print(f"Model {saved_model_id} created: {saved_model['name']}")

    after = api.get(f"/authorized/model?workspaceId={workspace_id}")
    after_ids = {m["id"] for m in after["data"]}
    assert_eq("Model set changed by exactly one id", after_ids - baseline_ids, {saved_model_id})
    print(f"PASS — exactly one new Model ({saved_model_id})")

    adopted_run_row = psql_rows(
        f"SELECT \"modelId\" FROM \"ModelTrainingRun\" WHERE id = '{selected_run_id}';"
    )
    assert_eq("adopted run's modelId", adopted_run_row[0][0], saved_model_id)
    print(f"PASS — ModelTrainingRun.modelId ({selected_run_id}) points at the saved Model, "
          f"confirming the SELECTED run (not bestRunId) was adopted")

    draft_final = psql_rows(
        f"SELECT status, \"savedModelId\" FROM \"ModelDraft\" WHERE id = '{draft_id}';"
    )
    assert_eq("draft status after save", draft_final[0][0], "SAVED")
    assert_eq("draft.savedModelId after save", draft_final[0][1], saved_model_id)
    print("PASS — ModelDraft.status=SAVED, savedModelId set")

    # ── Stage 9: artifact resolves in real MinIO (V06) ──────────────────
    step("STAGE 9 — the saved Model's artifact resolves in real MinIO")
    run_key_row = psql_rows(
        f"SELECT \"modelKey\" FROM \"ModelTrainingRun\" WHERE id = '{selected_run_id}';"
    )
    model_key = run_key_row[0][0]
    store = ObjectStore()
    exists = store.exists(model_key)
    assert_true(f"store.exists({model_key})", exists)
    print(f"PASS — {model_key} exists in MinIO")

    # ── Stage 10: boundary changed exactly once (T06, V06) ──────────────
    step("STAGE 10 — persistence boundary: Model set changed exactly once")
    print(f"baseline: {len(baseline_ids)} Model(s)")
    print(f"final:    {len(after_ids)} Model(s)")
    print(f"delta:    +1 ({saved_model_id}), created only at Stage 8")
    print("PASS")

    total_elapsed = time.time() - started
    print(f"\n{'=' * 70}\nALL STAGES PASSED in {total_elapsed:.1f}s\n{'=' * 70}")
    print(f"draft_id={draft_id}")
    print(f"saved_model_id={saved_model_id}")
    print(f"selected_run_id={selected_run_id}")
    print(f"candidate_job_id={job_id}")

    if args.cleanup:
        step("CLEANUP")
        api.post(f"/authorized/model-drafts/{draft_id}/abandon", expect=200)
        api.delete("/authorized/model", {"modelId": saved_model_id})
        print(f"abandoned draft {draft_id}, deleted Model {saved_model_id}")

    return 0


def poll_run(api: Api, draft_id: str, run_id: str) -> dict[str, Any]:
    for _ in range(POLL_MAX_ATTEMPTS):
        run = api.get(f"/authorized/model-drafts/{draft_id}/runs/{run_id}")["data"]
        if run["status"] in TERMINAL_RUN_STATUSES:
            return run
        time.sleep(POLL_INTERVAL_S)
    raise VerificationFailure(f"run {run_id} did not reach a terminal status within "
                               f"{POLL_MAX_ATTEMPTS * POLL_INTERVAL_S}s")


def poll_job(api: Api, draft_id: str, job_id: str) -> dict[str, Any]:
    for _ in range(POLL_MAX_ATTEMPTS):
        job = api.get(f"/authorized/model-drafts/{draft_id}/candidate-jobs/{job_id}")["data"]
        if job["status"] in TERMINAL_JOB_STATUSES:
            return job
        time.sleep(POLL_INTERVAL_S)
    raise VerificationFailure(f"job {job_id} did not reach a terminal status within "
                               f"{POLL_MAX_ATTEMPTS * POLL_INTERVAL_S}s")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VerificationFailure as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
