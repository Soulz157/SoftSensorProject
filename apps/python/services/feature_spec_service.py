"""`feature_spec.json` — the self-describing sidecar for a GOLD artifact.

Same role as `column_stats_service.py` plays for `column_stats.json`: this
builds the CONTENT only. Writing it beside the data (via `sidecar_key`/
`store.put_json`, the same mechanism `_commit` in `artifact_service.py`
already uses for `manifest.json`/`column_stats.json`) is DS-LAKE-006-T05's
job, once a real `/v1/preprocess/features` endpoint exists to call this.
`feature_spec_key(dataset_id, artifact_id)` (object_store.py) already builds
the object key this content is written to — it predates this file, from
DS-LAKE-003's key-builder consolidation, unused until now.

Field definitions (none of this vocabulary existed anywhere in the repo
before this task, grepped, confirmed empty):

* `features` — one entry per `FeatureConfig`, in the ORDER APPLIED (not
  sorted) — order is semantically meaningful for `applyFeatures`: a later
  config can read an earlier config's own derived column
  (DS-LAKE-006-T01's chaining fixture proves this), so two specs with the
  same features in a different order are NOT equivalent and must not hash
  the same.
* `selectedColumns` — `null` means "keep every column", the same identity
  meaning `selectColumns(ds, null)` already carries in the client.
* `scaling` — one `{tag, method}` pair per tag that has an explicit scaler
  entry. Sorted by tag for readability; the HASH does not depend on this
  ordering (dict keys are canonicalised before hashing — see
  `_canonical_hash_payload`), only on the mapping's actual content.
* `encoding` — always `[]` today. No categorical encoding exists ANYWHERE
  in the ported transform set (`applyFeatures`/`selectColumns`/
  `toModelReady` — grepped feature-engineering.ts and preprocessing.ts,
  confirmed no one-hot/label/ordinal encoding concept exists). Emitting an
  empty list here is the honest answer to a field the AC names but the
  current transform set has nothing to report for — inventing an encoding
  scheme nothing produces would be worse than an empty array.
* `featureVersion` — this SPEC'S OWN SHAPE version (bump when a field is
  added/removed/renamed here), NOT a per-feature version and NOT the
  artifact's `schemaVersion` — a distinct axis, deliberately named
  differently so the two are never confused at a call site.
* `featureHash` — sha256 over a canonical (sorted-keys, list-order-
  preserved) JSON encoding of `features` + `selectedColumns` + `scaling`.
  Stable for an identical configuration; changes when ANY transform,
  scaler, or selection changes (DS-LAKE-006's own acceptance criterion) —
  proven directly in `tests/test_feature_spec_quirks.py`, not merely
  asserted.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

from services.feature_service import feature_column_name

FEATURE_SPEC_VERSION = 1


def _canonical_hash_payload(
    features: Sequence[Mapping[str, Any]],
    selected_columns: list[str] | None,
    scaling: list[dict[str, Any]],
) -> str:
    """Deterministic JSON: `sort_keys=True` canonicalises each dict's OWN
    keys (insertion order of `{"kind": ..., "tag": ...}` must not matter),
    but list ORDER is preserved as-is, since `features`'s order is
    semantically meaningful (see module docstring) and must affect the hash.
    """
    return json.dumps(
        {
            "features": list(features),
            "selectedColumns": selected_columns,
            "scaling": scaling,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def build_feature_spec(
    features: Sequence[Mapping[str, Any]],
    selected_columns: list[str] | None,
    scalers: Mapping[str, str],
) -> dict[str, Any]:
    """Build `feature_spec.json`'s content for one GOLD write.

    `features` — the `FeatureConfig[]`-shaped list `applyFeatures`/
    `apply_features` consumed to produce this artifact, in APPLICATION
    order. `scalers` — the same `Record<string, ScalerMethod>` shape
    `toModelReady`/`to_model_ready` consumed.
    """
    scaling = [
        {"tag": tag, "method": method} for tag, method in sorted(scalers.items())
    ]
    canonical = _canonical_hash_payload(features, selected_columns, scaling)
    feature_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    return {
        "featureVersion": FEATURE_SPEC_VERSION,
        "features": [
            {
                "name": cfg.get("name") or feature_column_name(cfg),
                "kind": cfg["kind"],
                "config": {k: v for k, v in cfg.items() if k not in ("id", "name")},
            }
            for cfg in features
        ],
        "selectedColumns": selected_columns,
        "scaling": scaling,
        "encoding": [],
        "featureHash": feature_hash,
    }
