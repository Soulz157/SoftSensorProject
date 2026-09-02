#!/usr/bin/env python3
"""MODEL-SERVE-002-V02 — promote-under-load.

Polls /predict continuously against a real seeded Model (two ModelVersions,
v1 PRODUCTION / v2 STAGING), promotes v2 to PRODUCTION mid-poll via the same
DB transition promote() performs (demote old PRODUCTION -> ARCHIVED, set new
-> PRODUCTION), and asserts: zero request failures throughout, and the
returned `version` field flips from 1 to 2 within the 30s TTL bound
(descriptor cache) plus in-flight request latency.
"""
from __future__ import annotations

import time

import psycopg
import requests

DATABASE_URL = "postgresql://root:1234@localhost:5432/soft_sensor_db"
SERVING_URL = "http://localhost:8100"
MODEL_ID = "v02-test-model-0000-0000-0000-000000000001"
V1_ID = "v02-test-version-000-0000-0000-000000000001"
V2_ID = "v02-test-version-000-0000-0000-000000000002"
TTL_BOUND_SECONDS = 30

ROW = {
    "AI001A2.PV": 1.0, "AI001B2.PV": 1.0, "AI206.PV": 1.0, "FI001.PV": 1.0,
    "FI003.PV": 1.0, "FIC107R.PV": 1.0, "FIC114A.PV": 1.0, "FIC114B.PV": 1.0,
    "FIC114C.PV": 1.0, "FIC114D.PV": 1.0, "FIC114I.PV": 1.0, "FIC204.PV": 1.0,
    "FY107.CPV": 1.0, "Reflux_ratio_per_total_feed_of_Quench_oil_tower": 1.0,
    "Spgr_in_feed_Header_1": 1.0, "Spgr_in_feed_Header_2": 1.0,
    "TI202.PV": 1.0, "TI203.PV": 1.0, "TI205.PV": 1.0, "TI206.PV": 1.0,
    "TI207.PV": 1.0,
}


def predict():
    r = requests.post(
        f"{SERVING_URL}/v1/models/{MODEL_ID}/predict",
        json={"rows": [ROW]},
        timeout=10,
    )
    version = r.json().get("version") if r.status_code == 200 else None
    return r.status_code, version


def promote(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute('UPDATE "ModelVersion" SET stage=\'ARCHIVED\', "updatedAt"=now() WHERE id=%s', (V1_ID,))
        cur.execute('UPDATE "ModelVersion" SET stage=\'PRODUCTION\', "updatedAt"=now() WHERE id=%s', (V2_ID,))
    conn.commit()


def main() -> int:
    results: list[tuple[float, int, int | None]] = []
    start = time.time()
    promoted_at: float | None = None
    conn = psycopg.connect(DATABASE_URL)

    total_ticks = 90  # ~45s at 0.5s interval
    promote_at_tick = 10  # ~5s of steady-state v1 traffic first

    for i in range(total_ticks):
        t = time.time() - start
        status, version = predict()
        results.append((t, status, version))
        if i == promote_at_tick:
            promote(conn)
            promoted_at = time.time() - start
        time.sleep(0.5)

    conn.close()

    errors = [r for r in results if r[1] != 200]
    v1_times = [r[0] for r in results if r[2] == 1]
    v2_times = [r[0] for r in results if r[2] == 2]
    last_v1 = max(v1_times) if v1_times else None
    first_v2 = min(v2_times) if v2_times else None

    print(f"Total requests: {len(results)}")
    print(f"Promoted at t={promoted_at:.2f}s")
    print(f"Last v1 response at t={last_v1}")
    print(f"First v2 response at t={first_v2}")
    if errors:
        print(f"FAIL — {len(errors)} request(s) failed: {errors}")
        return 1
    if first_v2 is None:
        print("FAIL — v2 never observed within the poll window")
        return 1
    switchover_latency = first_v2 - promoted_at
    print(f"Switchover latency: {switchover_latency:.2f}s (bound: {TTL_BOUND_SECONDS}s + in-flight)")
    if switchover_latency > TTL_BOUND_SECONDS + 5:
        print("FAIL — switchover exceeded the stated bound")
        return 1
    print("PASS — zero failures, switchover landed inside the stated bound")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
