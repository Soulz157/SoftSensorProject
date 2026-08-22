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
* `scalingParams` (DS-LAKE-018-T02) — `{tag: {...fitted params}}` for every
  tag `to_model_ready` actually scaled with real fit state: `{min, max}`
  for minmax, `{mean, std}` for standard, `{median, iqr}` for robust.
  Absent for "none"-scaled tags and for a `robust` tag skipped entirely
  (zero finite values) — nothing was fit for either. NOT part of
  `featureHash` (see `build_feature_spec`'s own doc comment) — the same
  recipe over the same rows always fits the same numbers, so including
  them would churn the hash for a non-change. This is the field
  DS-LAKE-018-T04 reads to scale a raw holdout with the TRAIN rows'
  statistics instead of its own.
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
* `target_y` / `target_scaled` / `derived_from_target` — present ONLY when
  a target is passed (MODEL-FLOW-000-T02). These describe how a downstream
  training RUN reads this artifact, not how the artifact was built, so
  they are computed AFTER the hash and never enter it: two runs with
  different targets against the same GOLD bytes must still share a
  featureHash. `derived_from_target` is what
  `train.py::assert_no_target_leakage` gates on, so it must be the
  TRANSITIVE closure of "reads the target" — a later feature can read an
  earlier feature's own derived column (chaining fixture, see above), so a
  direct-read-only check would miss e.g. a rolling window over a lag of
  the target. An empty list there means "no target-derived features", not
  "unknown", so it is computed here rather than ever omitted.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

from services.feature_service import feature_column_name

FEATURE_SPEC_VERSION = 2  # DS-LAKE-018-T02: added `scalingParams`


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


def _derived_from_target(
    features: Sequence[Mapping[str, Any]], target_y: str
) -> list[str]:
    """Transitive closure of "reads the target", in application order.

    A config is target-derived if it reads the target directly, OR if it
    reads a column produced by an earlier target-derived config — features
    apply in order and a later one may read an earlier one's own output
    (module docstring above). Missing the transitive case would silently
    under-report `derived_from_target`, which is exactly the hole T02
    exists to close: the leakage guard trusts this list completely.
    """
    tainted = {target_y}
    derived: list[str] = []
    for cfg in features:
        out = cfg.get("name") or feature_column_name(cfg)
        reads: set[str] = set()
        tag = cfg.get("tag")
        if tag is not None:
            reads.add(tag)
        reads.update(cfg.get("tags") or [])
        reads.update((cfg.get("vars") or {}).values())
        if reads & tainted:
            tainted.add(out)
            derived.append(out)
    return sorted(derived)


def _reads_tags(cfg: Mapping[str, Any]) -> list[str]:
    """Which tag(s)/column(s) one FeatureConfig reads — same extraction
    `_derived_from_target` above inlines, factored out so
    `max_replay_lookback` can reuse it without re-deriving the per-kind
    field names (`tag` vs `tags` vs `vars`) a second time.
    """
    if cfg.get("kind") == "datetime":
        return []
    reads: list[str] = []
    tag = cfg.get("tag")
    if tag is not None:
        reads.append(tag)
    reads.extend(cfg.get("tags") or [])
    reads.extend((cfg.get("vars") or {}).values())
    return reads


def _own_lookback(cfg: Mapping[str, Any]) -> int:
    """Rows BEFORE the current one this config's OWN computation reads —
    ignoring whatever its source column itself may need (that is
    `max_replay_lookback`'s job, via compounding).

    `rolling(window)` uses `window` here, not `window-1` — one row more
    than `_compute_feature_column`'s own `[i-window+1, i]` strictly needs.
    Matches this task's own worked example (scope_note: "lag(5) of
    rolling(60) needs 65") and is deliberately conservative: the lead-in
    check this feeds is a REFUSAL, and refusing one row early is a cheap
    UI-time widening away, where under-refusing is the silent, hard-to-trace
    failure this whole check exists to prevent.
    """
    kind = cfg.get("kind")
    if kind == "lag":
        return int(cfg["k"])
    if kind == "delta":
        return 1
    if kind == "rolling":
        return int(cfg["window"])
    return 0


def max_replay_lookback(features: Sequence[Mapping[str, Any]]) -> int:
    """DS-LAKE-018-T04. The deepest number of rows, before the holdout
    boundary, ANY feature in this recipe needs to compute correctly —
    compounding through chained configs exactly like `_derived_from_target`
    does (a later config may read an earlier config's own derived column,
    module docstring). `lag(5)` of a `rolling(60)` column needs the
    rolling's own 60-row lookback PLUS the lag's 5, not just 5 — reading
    only the outermost config's own window would silently under-count.

    Used as a REFUSAL threshold (DS-LAKE-018-T04's replay endpoint), not a
    warning: a holdout whose captured lead-in falls short of this produces
    null/wrong lag-rolling values for its own first rows, which then feed
    straight into `predict()` with no trace of why the metric moved.
    """
    lookback_by_output: dict[str, int] = {}
    overall_max = 0
    for cfg in features:
        out = cfg.get("name") or feature_column_name(cfg)
        source_lookback = max(
            (lookback_by_output.get(tag, 0) for tag in _reads_tags(cfg)),
            default=0,
        )
        total = _own_lookback(cfg) + source_lookback
        lookback_by_output[out] = total
        overall_max = max(overall_max, total)
    return overall_max


def build_feature_spec(
    features: Sequence[Mapping[str, Any]],
    selected_columns: list[str] | None,
    scalers: Mapping[str, str],
    target_y: str | None = None,
    scaling_params: Mapping[str, Mapping[str, float]] | None = None,
) -> dict[str, Any]:
    """Build `feature_spec.json`'s content for one GOLD write.

    `features` — the `FeatureConfig[]`-shaped list `applyFeatures`/
    `apply_features` consumed to produce this artifact, in APPLICATION
    order. `scalers` — the same `Record<string, ScalerMethod>` shape
    `toModelReady`/`to_model_ready` consumed. `target_y` — the tag a
    downstream training run predicts; optional because this sidecar is
    also written for artifacts nothing will ever train on.

    `scaling_params` (DS-LAKE-018-T02) — the FITTED params each scaler
    computed on these train rows (`to_model_ready`'s own second return
    value), keyed by tag. Deliberately NOT part of `featureHash`: the hash
    answers "was this the same recipe", and the same recipe over the same
    rows always fits the same parameters — including them would churn the
    hash for a non-change. Without this field nothing downstream can scale a
    holdout the way the model was actually trained (see finding: re-fitting
    on the holdout's own statistics is a silently DIFFERENT, wrong
    transform).
    """
    scaling = [
        {"tag": tag, "method": method} for tag, method in sorted(scalers.items())
    ]
    canonical = _canonical_hash_payload(features, selected_columns, scaling)
    feature_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    spec: dict[str, Any] = {
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
        "scalingParams": dict(scaling_params) if scaling_params else {},
        "encoding": [],
        "featureHash": feature_hash,
    }

    if target_y is not None:
        # Explicit False, not omitted: train.py distinguishes "recorded as
        # unscaled" from "never recorded" (feature_spec.json predates this
        # field on any artifact written before T02).
        spec["target_y"] = target_y
        spec["target_scaled"] = scalers.get(target_y, "none") != "none"
        spec["derived_from_target"] = _derived_from_target(features, target_y)

    return spec
