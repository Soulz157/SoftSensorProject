#!/usr/bin/env python3
"""DS-LAKE-012-T06 — synthetic wide-artifact generator.

Writes a real Parquet object to MinIO (via the real `ObjectStore`, same
code path production writes use) at a chosen tag width, then prints the
`INSERT` statements to wire it into Postgres as a BRONZE `DatasetArtifact`
under a chosen `DatasetDraft`, so the real backend endpoints
(`/metadata`, `/tags`, `/rows`, `/column-stats`) can be exercised against
it for real rather than against a mock.

Same methodology `docs/DS-LAKE-005B-C-BENCHMARK.md` already used and
recorded results for (1,000 rows fixed, tag count varies,
`columnCount = 2 * tags + 1` counting the `__status` sidecar per tag plus
`timestamp`) — this script does not repeat that storage-layer benchmark,
it only produces one real artifact so the API/UI boundedness claims
(T06/T07/T08/V06) can be checked against real data at the acceptance
criterion's own "8,000+ tags" threshold.

    apps/python/.venv/bin/python scripts/verify/generate-wide-artifact.py \\
        --tags 8000 --rows 1000 --draft-id <uuid> --artifact-id <uuid>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "apps" / "python"))

from intergrations.object_store import ObjectStore, artifact_key  # noqa: E402


def build_frame(tags: int, rows: int) -> pd.DataFrame:
    rng = np.random.default_rng(12345)
    timestamps = pd.date_range("2026-01-01", periods=rows, freq="1min")
    data: dict[str, object] = {"timestamp": timestamps}
    for i in range(tags):
        tag = f"SYN-{i:05d}.PV"
        data[tag] = rng.normal(loc=50.0, scale=5.0, size=rows).round(3)
        # int8 quality code, not a string — object_store.py:25 documents the
        # real physical layout as `0=Good, 1=Bad, 2=Questionable`
        # (STATUS_GOOD=0). A string here (first attempt) passed `put_frame`
        # silently but broke `/rows` downstream with `invalid literal for
        # int() with base 10: 'Good'` — sample_rows() decodes the int8 code
        # back to a display string, it does not accept one on the way in.
        data[f"{tag}__status"] = np.zeros(rows, dtype=np.int8)
    return pd.DataFrame(data)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tags", type=int, required=True)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--draft-id", required=True)
    parser.add_argument("--artifact-id", required=True)
    args = parser.parse_args()

    frame = build_frame(args.tags, args.rows)
    key = artifact_key(f"drafts/{args.draft_id}", args.artifact_id)

    store = ObjectStore()
    stats = store.put_frame(frame, key, overwrite=True)

    print(f"objectKey: {key}")
    print(f"rowCount: {stats.row_count}")
    print(f"columnCount (incl. __status + timestamp): {len(frame.columns)}")
    print(f"sizeBytes: {stats.size_bytes}")
    print(f"checksum: {stats.checksum}")
    print()
    print("-- Postgres wiring (run via psql):")
    print(
        f"""INSERT INTO "DatasetArtifact"
  (id, "draftId", "runId", "parentArtifactId", type, "objectKey", format,
   checksum, "schemaVersion", "columnCount", "featureCount", "rowCount",
   "missingPct", "sizeBytes", operations, "createdById", "createdAt")
VALUES
  ('{args.artifact_id}', '{args.draft_id}', gen_random_uuid(), NULL,
   'BRONZE', '{key}', 'parquet', '{stats.checksum}', 1, {args.tags}, 0,
   {stats.row_count}, 0, {stats.size_bytes}, '[]'::jsonb,
   (SELECT "createdById" FROM "DatasetDraft" WHERE id = '{args.draft_id}'),
   now());
UPDATE "DatasetDraft" SET "currentArtifactId" = '{args.artifact_id}'
  WHERE id = '{args.draft_id}';"""
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
