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
* `psiRefEdges` / `psiBinCount` / `psiBinMode` / `psiRefCounts` (MODEL-
  SERVE-001-T13, resolved openDecision) — one entry per tag in each, keyed
  the same way `scalingParams` is. Frozen PSI reference bins, computed ONCE
  by `compute_psi_ref_edges` (delegating the actual binning to
  `softsensor_scaling.psi.quantile_edges` — SHARED with `apps/serving`'s
  live bucketing, so training and serving can never bucket a value
  differently) over the TRAIN split's Good, RAW (pre-`to_model_ready`)
  values — never re-fit per inference window, for the identical reason
  `scalingParams` is fit-once-and-reused rather than re-derived (see
  finding above). RAW, not scaled: T13 STEP 4 found the drift z-score's own
  baseline (`column_stats.json`) is scaled, but PSI's bin edges are NOT
  scale-invariant the way a z-score is, so they are frozen in the SAME raw
  engineering units a live `/predict` payload's `rows` actually carries.
  `psiBinMode` is `"continuous"` (edges are `binCount + 1` quantile
  boundaries) or `"categorical"` (edges are the sorted distinct Good values
  themselves, one bin per value) — `quantile_edges`'s own degenerate-tag
  rule decides which. `psiRefCounts` is the REAL measured reference count
  per bin — see `softsensor_scaling.psi`'s own module docstring for why
  this is measured rather than assumed uniform (a categorical split is NOT
  equal-frequency the way a quantile split is). Like `scalingParams`, NOT
  part of `featureHash` (the same recipe over the same rows always produces
  the same edges) and absent for a tag with zero Good values in the
  observed train split (nothing to bin — never a fabricated single-point
  edge set).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping, Sequence

import pandas as pd

from services.boxplot_service import good_values
from services.feature_service import feature_column_name
from softsensor_scaling import _own_lookback, _reads_tags, max_replay_lookback
from softsensor_scaling import quantile_edges as _quantile_edges
from softsensor_scaling import tag_columns as _tag_columns
from softsensor_scaling.psi import DEFAULT_PSI_BIN_COUNT

# MODEL-SERVE-002-T06: `max_replay_lookback` (with `_reads_tags`/
# `_own_lookback`) moved to softsensor_scaling.features and is imported
# back here under its original name, so `from services.feature_spec_service
# import max_replay_lookback` (artifact_service.py:95, and this module's own
# tests) is unchanged. It moved because apps/serving reports the SAME number
# to a /predict caller that prepare_holdout_for_run already refuses on — one
# implementation, not two. Re-exported explicitly below.

__all__ = [
    "FEATURE_SPEC_VERSION",
    "build_feature_spec",
    "compute_psi_ref_edges",
    "max_replay_lookback",
    "_own_lookback",
    "_reads_tags",
]

FEATURE_SPEC_VERSION = 3  # MODEL-SERVE-001-T13: added psiRefEdges/psiBinCount/psiBinMode/psiRefCounts


def compute_psi_ref_edges(
    frame: pd.DataFrame,
    tags: Sequence[str] | None = None,
    bin_count: int = DEFAULT_PSI_BIN_COUNT,
) -> dict[str, dict[str, Any]]:
    """Per-tag frozen PSI reference bins for one GOLD write — MODEL-SERVE-
    001-T13. Computed ONCE, over the TRAIN split's Good RAW values, and
    frozen for the `ModelVersion`'s lifetime; never re-fit per inference
    window, for the identical reason DS-LAKE-005B-A-V06's shared-bucket-
    basis rule exists for the scrubber.

    The actual binning (quantile edges, degenerate-tag rule, measured
    `refCounts`) is `softsensor_scaling.psi.quantile_edges` — SHARED with
    `apps/serving`'s live-row bucketing, so a value is binned the identical
    way at training time and at inference time. This function's own job is
    only the frame-level plumbing: which tags, which Good-cell values.

    CALL THIS AFTER `apply_features`/`drop_bad_feature_rows` (derived
    columns must have edges too, and a Bad hole must not skew them) and
    BEFORE `to_model_ready` (T13 STEP 4: calling this on an already-scaled
    frame would freeze edges in [0,1] model-ready units, but a live
    `/predict` payload's `rows` are raw engineering units — the same
    caller-ordering constraint `drop_bad_feature_rows` itself documents).

    Reuses `boxplot_service.good_values` — the same Good-cell filter
    `column_stats_service.build_column_stats` and `split_stats_service` use
    — rather than a fourth private copy (`histogram_service`/
    `correlation_selector` already duplicate it intentionally for
    module-local one-off use; this call site crosses modules, the case
    `good_values` was promoted public for — see its own docstring).

    Keyed by tag, `tags=None` meaning "every tag_columns(frame)" — the same
    default `build_column_stats` uses. A tag absent from `frame` is
    skipped, not raised: `features()`/`scale()` may pass a tag list from a
    caller's recipe that does not perfectly match what actually landed.
    """
    for_tags = tags if tags is not None else _tag_columns(frame)
    result: dict[str, dict[str, Any]] = {}
    for tag in for_tags:
        if tag not in frame.columns:
            continue
        edges = _quantile_edges(good_values(frame, tag), bin_count)
        if edges is not None:
            result[tag] = edges
    return result


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


def build_feature_spec(
    features: Sequence[Mapping[str, Any]],
    selected_columns: list[str] | None,
    scalers: Mapping[str, str],
    target_y: str | None = None,
    scaling_params: Mapping[str, Mapping[str, float]] | None = None,
    psi_ref_edges: Mapping[str, Mapping[str, Any]] | None = None,
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

    `psi_ref_edges` (MODEL-SERVE-001-T13) — `compute_psi_ref_edges`'s
    return value, keyed by tag to `{binMode, binCount, edges, refCounts}`.
    Same not-part-of-`featureHash` treatment as `scaling_params`, for the
    same reason. Unpacked into four sibling top-level fields below
    (`psiRefEdges`/`psiBinCount`/`psiBinMode`/`psiRefCounts`) rather than
    kept nested, matching the literal field names this task's own resolved
    openDecision names.
    """
    scaling = [
        {"tag": tag, "method": method} for tag, method in sorted(scalers.items())
    ]
    canonical = _canonical_hash_payload(features, selected_columns, scaling)
    feature_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    psi = dict(psi_ref_edges) if psi_ref_edges else {}

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
        "psiRefEdges": {tag: entry["edges"] for tag, entry in psi.items()},
        "psiBinCount": {tag: entry["binCount"] for tag, entry in psi.items()},
        "psiBinMode": {tag: entry["binMode"] for tag, entry in psi.items()},
        "psiRefCounts": {tag: entry["refCounts"] for tag, entry in psi.items()},
    }

    if target_y is not None:
        # Explicit False, not omitted: train.py distinguishes "recorded as
        # unscaled" from "never recorded" (feature_spec.json predates this
        # field on any artifact written before T02).
        spec["target_y"] = target_y
        spec["target_scaled"] = scalers.get(target_y, "none") != "none"
        spec["derived_from_target"] = _derived_from_target(features, target_y)

    return spec
