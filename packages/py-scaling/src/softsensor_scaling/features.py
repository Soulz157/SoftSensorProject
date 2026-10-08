"""Feature-recipe introspection — naming, and how much history a recipe needs.

MODEL-SERVE-002-T06. Moved verbatim out of `apps/python`:
`feature_column_name` from `services/feature_service.py`, and
`max_replay_lookback` (with `_reads_tags`/`_own_lookback`) from
`services/feature_spec_service.py`, where it was written for DS-LAKE-018-T04's
holdout replay.

WHY IT LIVES HERE NOW. `apps/serving` must tell a caller how much target
history a target-derived model's recipe actually needs, and the answer is a
property of the RECIPE, not of the data — the same number, derived the same
way, that `artifact_service.prepare_holdout_for_run` already refuses on. Two
implementations of "how deep does this recipe reach back" would be the exact
drift the extraction decision exists to prevent
(decisions.serving_transform_is_an_extracted_module); `apps/python` imports
these back from here under their original names, so every existing caller is
unchanged.

NOTE ON UNITS — ROWS, NEVER A DURATION. This is deliberate and predates
serving: `artifact_service.py`'s own lead-in check states it, "computed from
the recipe's own compound lookback ... NOT re-derived from a duration/interval
a caller would have to look up." `lag(k)` reaches back k ROWS; converting that
to a wall-clock interval needs a sampling cadence that no `feature_spec.json`
records and no Prisma column holds. See MODEL-SERVE-002-T06's premise
correction in docs/feature_list_model.json.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .scaling import FeatureError


def feature_column_name(cfg: Mapping[str, Any]) -> str:
    kind = cfg.get("kind")
    if kind == "lag":
        return f"{cfg['tag']}__lag{cfg['k']}"
    if kind == "rolling":
        return f"{cfg['tag']}__roll{cfg['window']}_{cfg['agg']}"
    if kind == "ratio":
        return "__over__".join(cfg["tags"])
    if kind == "delta":
        return f"{cfg['tag']}__delta"
    if kind == "arith":
        return f"__{cfg['op']}__".join(cfg["tags"])
    if kind == "log":
        return f"{cfg['tag']}__log"
    if kind == "datetime":
        return f"__dt_{cfg['part']}"
    if kind == "formula":
        name = (cfg.get("name") or "").strip()
        return name or cfg["expr"]
    raise FeatureError(f"Unknown feature kind {kind!r}")


def _reads_tags(cfg: Mapping[str, Any]) -> list[str]:
    """Which tag(s)/column(s) one FeatureConfig reads — same extraction
    `_derived_from_target` inlines, factored out so `max_replay_lookback`
    can reuse it without re-deriving the per-kind field names (`tag` vs
    `tags` vs `vars`) a second time.
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
    than the computation strictly needs. Deliberately conservative: the
    checks this feeds are REFUSALS, and refusing one row early is a cheap
    widening away, where under-refusing is the silent, hard-to-trace
    failure the check exists to prevent.
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
    compounding through chained configs (a later config may read an earlier
    config's own derived column). `lag(5)` of a `rolling(60)` column needs
    the rolling's own 60-row lookback PLUS the lag's 5, not just 5 —
    reading only the outermost config's own window would silently
    under-count.

    Used as a REFUSAL threshold (DS-LAKE-018-T04's replay endpoint), not a
    warning: a holdout whose captured lead-in falls short of this produces
    null/wrong lag-rolling values for its own first rows, which then feed
    straight into `predict()` with no trace of why the metric moved.
    MODEL-SERVE-002-T06 reports the same number to a /predict caller, for
    the same reason one layer up.
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
