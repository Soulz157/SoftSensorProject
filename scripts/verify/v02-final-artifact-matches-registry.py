#!/usr/bin/env python3
"""DS-LAKE-012-V02 — "Reconstruct the final dataset from its MinIO artifact
and assert it matches the registry's recorded rowCount, featureCount and
checksum."

Deliberately takes the registry's own recorded values as CLI args (looked
up separately via `psql` — see `docs/DS-LAKE-012-VERIFICATION.md`) rather
than querying Postgres itself, so this script only needs the real
`ObjectStore` (boto3, already a python dependency) and no new pip package.

    apps/python/.venv/bin/python scripts/verify/v02-final-artifact-matches-registry.py \\
        <objectKey> <expectedRowCount> <expectedColumnCount> [expectedChecksum]

`expectedColumnCount` is `DatasetVersion.columnCount` — the LOGICAL tag
count (every non-timestamp, non-`__status` column), NOT
`DatasetVersion.featureCount` (engineered features only, legitimately 0 on
a chain with no feature-engineering step). Confirmed against a real row
this session: `columnCount=2`/`featureCount=0` on a FINAL artifact whose
Parquet frame genuinely has 2 tag columns — comparing against
`featureCount` instead flags a false mismatch.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "apps" / "python"))

from intergrations.object_store import ObjectStore  # noqa: E402


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "usage: v02-final-artifact-matches-registry.py <objectKey> "
            "<expectedRowCount> <expectedColumnCount> [expectedChecksum]",
            file=sys.stderr,
        )
        return 2

    key = sys.argv[1]
    expected_rows = int(sys.argv[2])
    expected_columns = int(sys.argv[3])
    expected_checksum = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

    store = ObjectStore()
    print(f"objectKey: {key}")

    raw_bytes = store._client.get_object(store.bucket, key).read()  # noqa: SLF001
    real_checksum = hashlib.sha256(raw_bytes).hexdigest()

    frame = store.get_frame(key)
    real_rows = len(frame)
    tag_cols = [
        c for c in frame.columns if c != "timestamp" and not c.endswith("__status")
    ]
    real_columns = len(tag_cols)

    print(f"recomputed rowCount={real_rows}      expected={expected_rows}")
    print(f"recomputed columnCount={real_columns}  expected={expected_columns}")
    print(f"recomputed checksum={real_checksum}")
    print(f"expected  checksum={expected_checksum}")

    findings = []
    if real_rows != expected_rows:
        findings.append(f"rowCount mismatch: {real_rows} != {expected_rows}")
    if real_columns != expected_columns:
        findings.append(
            f"columnCount mismatch: {real_columns} != {expected_columns}"
        )
    if expected_checksum and real_checksum != expected_checksum:
        findings.append(
            f"checksum mismatch: {real_checksum} != {expected_checksum}"
        )

    if findings:
        print("\nV02 FINDINGS:")
        for f in findings:
            print(f"  - {f}")
        return 1

    print("\nV02 PASS — MinIO reconstruction matches the registry exactly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
