#!/usr/bin/env python3
"""MODEL-SERVE-002-V01 — the load-bearing verification.

PROVES NO SKEW: takes rows from a real training run's own SILVER artifact
(the feature-engineered, PRE-SCALING frame — GOLD is already scaled, see
docs/feature_list_model.json's 2026-09-02 finding), sends them through the
live synchronous /predict endpoint, and asserts the result matches that
run's own recorded predictions.parquet to numerical tolerance.

Any test using synthetic input proves the endpoint returns a float, which
is not the claim — this script never fabricates a feature row.

Usage:
    DATABASE_URL=postgresql://... \\
    python3 scripts/verify/model_serve_002_v01.py --model-id <ModelVersion's Model.id>

Run from apps/python's venv (already has psycopg, minio, pyarrow, pandas,
requests) — no new dependency exists solely for this script:

    apps/python/.venv/bin/python3 scripts/verify/model_serve_002_v01.py \\
        --model-id v01-test-model-0000-0000-0000-000000000001
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys

import pandas as pd
import psycopg
import pyarrow.parquet as pq
import requests
from minio import Minio


def _minio_client(endpoint: str) -> Minio:
    host = endpoint.replace("http://", "").replace("https://", "")
    return Minio(
        host,
        access_key=os.environ.get("S3_ACCESS_KEY", "admin"),
        secret_key=os.environ.get("S3_SECRET_KEY", "password"),
        secure=endpoint.startswith("https://"),
    )


def _read_frame(client: Minio, bucket: str, key: str) -> pd.DataFrame:
    resp = client.get_object(bucket, key)
    try:
        return pq.read_table(io.BytesIO(resp.read())).to_pandas()
    finally:
        resp.close()
        resp.release_conn()


def _read_json(client: Minio, bucket: str, key: str) -> dict:
    resp = client.get_object(bucket, key)
    try:
        return json.loads(resp.read())
    finally:
        resp.close()
        resp.release_conn()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", required=True, help="Model.id owning a PRODUCTION ModelVersion")
    parser.add_argument("--serving-url", default=os.environ.get("SERVING_URL", "http://localhost:8100"))
    parser.add_argument("--n", type=int, default=20, help="Number of rows to check")
    parser.add_argument("--bucket", default=os.environ.get("S3_BUCKET", "datasets"))
    parser.add_argument("--s3-endpoint", default=os.environ.get("S3_ENDPOINT", "http://localhost:9000"))
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--tolerance", type=float, default=1e-6)
    args = parser.parse_args()

    if not args.database_url:
        print("DATABASE_URL not set (env var or --database-url)", file=sys.stderr)
        return 2

    with psycopg.connect(args.database_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r."predictionsKey", r."goldArtifactId", r."manifestKey",
                   r.algorithm, r."cvFoldsKey"
            FROM "ModelVersion" v
            JOIN "ModelTrainingRun" r ON r.id = v."sourceRunId"
            WHERE v."modelId" = %s AND v.stage = 'PRODUCTION'
            """,
            (args.model_id,),
        )
        row = cur.fetchone()
        if not row:
            print(f"No PRODUCTION version found for model {args.model_id}", file=sys.stderr)
            return 2
        run_id, predictions_key, gold_artifact_id, manifest_key, algorithm, cv_folds_key = row

        # MODEL-SERVE-000-T04's live finding: a CV run's predictions.parquet
        # is a REPLAYED HOLDOUT score, a different frame entirely from
        # GOLD/SILVER's own lineage — this script's SILVER lookup would
        # silently miss every timestamp. Refuse rather than produce a
        # false failure that looks like a skew bug.
        if cv_folds_key:
            print(
                f"Run {run_id} is a Cross-Validation run (cvFoldsKey set) — "
                "its predictions are a replayed holdout score, not GOLD/"
                "SILVER's own test split. Pick a non-CV run for this check.",
                file=sys.stderr,
            )
            return 2
        if not predictions_key:
            print(f"Run {run_id} has no predictionsKey.", file=sys.stderr)
            return 2
        if not manifest_key:
            print(f"Run {run_id} has no manifestKey.", file=sys.stderr)
            return 2

        # ModelTrainingRun.goldArtifactId names the FINAL artifact the run
        # actually trained against (findings[]: "the run's goldArtifactId
        # reads drafts/…/artifacts/… — this IS the FINAL row", verified
        # live), not GOLD itself despite the column name — the lineage is
        # BRONZE -> SILVER -> GOLD -> FINAL, so SILVER is two hops up:
        # FINAL.parentArtifactId = GOLD, GOLD.parentArtifactId = SILVER.
        cur.execute(
            """
            SELECT silver."objectKey"
            FROM "DatasetArtifact" final
            JOIN "DatasetArtifact" gold ON gold.id = final."parentArtifactId"
            JOIN "DatasetArtifact" silver ON silver.id = gold."parentArtifactId"
            WHERE final.id = %s AND gold.type = 'GOLD' AND silver.type = 'SILVER'
            """,
            (gold_artifact_id,),
        )
        silver_row = cur.fetchone()
        if not silver_row:
            print(
                f"No SILVER parent artifact found for {gold_artifact_id} — "
                "it may have been reclaimed. Pick a different run.",
                file=sys.stderr,
            )
            return 2
        silver_key = silver_row[0]

    client = _minio_client(args.s3_endpoint)
    manifest = _read_json(client, args.bucket, manifest_key)
    feature_columns: list[str] = manifest["feature_columns"]

    predictions = _read_frame(client, args.bucket, predictions_key)
    silver = _read_frame(client, args.bucket, silver_key)
    silver_by_ts = silver.set_index("timestamp")

    sample = predictions.head(args.n)
    rows: list[dict] = []
    recorded: list[float] = []
    skipped = 0
    for _, pred_row in sample.iterrows():
        ts = pred_row["timestamp"]
        if ts not in silver_by_ts.index:
            skipped += 1
            continue
        silver_row_data = silver_by_ts.loc[ts]
        rows.append({c: float(silver_row_data[c]) for c in feature_columns})
        recorded.append(float(pred_row["y_pred"]))

    if not rows:
        print(
            f"None of the first {args.n} prediction timestamps were found "
            "in SILVER — cannot verify.",
            file=sys.stderr,
        )
        return 2

    response = requests.post(
        f"{args.serving_url.rstrip('/')}/v1/models/{args.model_id}/predict",
        json={"rows": rows},
        timeout=30,
    )
    if response.status_code != 200:
        print(f"/predict returned {response.status_code}: {response.text}", file=sys.stderr)
        return 1

    live = response.json()["predictions"]
    if len(live) != len(recorded):
        print(f"Row count mismatch: sent {len(rows)}, got {len(live)} predictions back.", file=sys.stderr)
        return 1

    max_diff = 0.0
    failures = 0
    for i, (live_val, recorded_val) in enumerate(zip(live, recorded)):
        diff = abs(live_val - recorded_val)
        max_diff = max(max_diff, diff)
        if diff > args.tolerance:
            failures += 1
            print(
                f"  MISMATCH row {i}: live={live_val!r} recorded={recorded_val!r} diff={diff!r}"
            )

    print(f"Run: {run_id}  algorithm={algorithm}")
    print(f"Checked {len(rows)} row(s) ({skipped} skipped, not found in SILVER)")
    print(f"Max |live - recorded| = {max_diff!r} (tolerance {args.tolerance!r})")
    if failures:
        print(f"FAIL — {failures} row(s) exceeded tolerance")
        return 1
    print("PASS — /predict reproduces the run's own recorded predictions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
