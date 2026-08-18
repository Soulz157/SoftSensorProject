"""DS-LAKE-007-T01: the validation checks a committed artifact must pass
before it may become official.

Read-only, by design (AC: "writes no data artifact and mutates no frame") —
every check here inspects a frame and returns a result; none of them ever
call `store.put_frame`/`put_json`. Writing `validation_report.json` beside
the data is T02's job (the HTTP layer around this), mirroring how
`column_stats_service`/`feature_spec_service` are pure content-builders and
`artifact_service._commit` is the one place that actually writes.

Reuses `column_stats_service.build_column_stats` for every per-tag stat this
needs (coverage/null_pct/outlier_count/min/max) rather than re-deriving —
same "reuse, don't re-derive" discipline `feature_service.py` already
applied to `cleaning_service._median_sorted`/`_round_to`.

Six checks, matching the task's own list:

* `schema` — wraps `object_store.assert_frame_shape` (the frame contract's
  existing enforcement primitive, per this feature's own description).
* `missing_values` — per-tag `null_pct` (from `build_column_stats`) against
  a threshold; a tag with real values but too many Bad/Questionable cells
  fails, not just a completely empty tag.
* `duplicate_timestamps` — `timestamp` column has no repeats.
* `feature_consistency` — every feature `feature_spec.json` named actually
  exists as a column. Only meaningful for a GOLD/FINAL artifact with a real
  spec; `feature_spec=None` (BRONZE/SILVER) SKIPS this check rather than
  failing it — there is nothing to be consistent WITH yet, which is not the
  same claim as "consistent."
* `statistical` — flags a DEGENERATE tag (every Good value identical —
  `min == max` — despite enough coverage to have real variance, e.g. a
  stuck sensor) and a tag whose outlier fraction exceeds a threshold. Two
  distinct measured quantities pinned as ONE check because both answer the
  same question ("does this tag's distribution look real"), not because
  either is a duplicate of `missing_values` or `feature_consistency`.
* `completeness` — every EXPECTED tag (an explicit list — normally the
  wizard's own base tag selection) is present as a column. `expected_tags
  =None` skips this check, same reasoning as `feature_consistency`.

Thresholds are PARAMETERS with stated defaults here (module constants
below) — DS-LAKE-007-T05 is what threads real configurability through the
endpoint/request; this task only needs the parameter to exist, not a config
system behind it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

import pandas as pd

from intergrations.object_store import (
    TIMESTAMP_COLUMN,
    assert_frame_shape,
    tag_columns,
)
from services.column_stats_service import build_column_stats

# ── default thresholds (DS-LAKE-007-T05 makes these configurable) ─────────
DEFAULT_MAX_MISSING_PCT = 20.0
DEFAULT_MAX_OUTLIER_FRACTION = 0.10


@dataclass
class CheckResult:
    """One named check's outcome.

    `measured`/`threshold` are the numbers a FAIL is measured against (AC:
    "names which check failed and by how much") — `None` for a check with
    no single scalar magnitude (e.g. `schema`, which is structurally
    pass/fail). `offenders` names WHICH tags/rows drove a FAIL, not just
    that something somewhere did.
    """

    name: str
    passed: bool
    detail: str
    measured: float | None = None
    threshold: float | None = None
    offenders: list[str] = field(default_factory=list)
    skipped: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "skipped": self.skipped,
            "detail": self.detail,
            "measured": self.measured,
            "threshold": self.threshold,
            "offenders": self.offenders,
        }


def check_schema(df: pd.DataFrame) -> CheckResult:
    try:
        assert_frame_shape(df)
        return CheckResult("schema", True, "Frame shape is valid.")
    except ValueError as err:
        return CheckResult("schema", False, str(err))


def check_duplicate_timestamps(df: pd.DataFrame) -> CheckResult:
    if TIMESTAMP_COLUMN not in df.columns:
        # assert_frame_shape (the schema check) already reports this —
        # avoid a second, less specific failure for the same root cause.
        return CheckResult(
            "duplicate_timestamps", False, "No timestamp column to check.", skipped=True
        )
    duplicated = df[TIMESTAMP_COLUMN].duplicated()
    count = int(duplicated.sum())
    if count == 0:
        return CheckResult("duplicate_timestamps", True, "No duplicate timestamps.")
    return CheckResult(
        "duplicate_timestamps",
        False,
        f"{count} duplicate timestamp(s) found.",
        measured=float(count),
        threshold=0.0,
    )


def check_missing_values(
    df: pd.DataFrame, threshold: float = DEFAULT_MAX_MISSING_PCT
) -> CheckResult:
    stats = build_column_stats(df, operations=[])
    offenders = {
        tag: s["null_pct"] for tag, s in stats.items() if s["null_pct"] > threshold
    }
    if not offenders:
        return CheckResult(
            "missing_values",
            True,
            f"Every tag's missing rate is within {threshold}%.",
            threshold=threshold,
        )
    worst_tag = max(offenders, key=lambda t: offenders[t])
    return CheckResult(
        "missing_values",
        False,
        f"{len(offenders)} tag(s) exceed {threshold}% missing "
        f"(worst: {worst_tag} at {offenders[worst_tag]}%).",
        measured=offenders[worst_tag],
        threshold=threshold,
        offenders=sorted(offenders),
    )


def check_feature_consistency(
    df: pd.DataFrame, feature_spec: Mapping[str, Any] | None
) -> CheckResult:
    if feature_spec is None:
        return CheckResult(
            "feature_consistency",
            True,
            "No feature_spec.json for this artifact — nothing to be "
            "consistent with (BRONZE/SILVER artifacts skip this check).",
            skipped=True,
        )
    present = set(tag_columns(df))
    expected = {f["name"] for f in feature_spec.get("features", [])}
    missing = sorted(expected - present)
    if not missing:
        return CheckResult(
            "feature_consistency",
            True,
            "Every feature named in feature_spec.json is present.",
        )
    return CheckResult(
        "feature_consistency",
        False,
        f"{len(missing)} feature(s) named in feature_spec.json are missing "
        f"from the artifact: {missing}.",
        measured=float(len(missing)),
        threshold=0.0,
        offenders=missing,
    )


def check_statistical(
    df: pd.DataFrame, max_outlier_fraction: float = DEFAULT_MAX_OUTLIER_FRACTION
) -> CheckResult:
    stats = build_column_stats(df, operations=[])
    n = int(len(df))

    degenerate: list[str] = []
    high_outlier: list[str] = []
    worst_outlier_fraction = 0.0

    for tag, s in stats.items():
        if s["min"] is not None and s["max"] is not None and s["min"] == s["max"]:
            # A real reading with zero variance across the whole artifact —
            # a stuck sensor, not a legitimately constant one (coverage < a
            # single point tells us nothing either way, so require some).
            if s["coverage"] > 0:
                degenerate.append(tag)
        if n > 0:
            fraction = s["outlier_count"] / n
            if fraction > max_outlier_fraction:
                high_outlier.append(tag)
                worst_outlier_fraction = max(worst_outlier_fraction, fraction)

    offenders = sorted(set(degenerate) | set(high_outlier))
    if not offenders:
        return CheckResult(
            "statistical",
            True,
            "No degenerate (zero-variance) tags and every tag's outlier "
            f"fraction is within {max_outlier_fraction:.0%}.",
            threshold=max_outlier_fraction,
        )
    parts = []
    if degenerate:
        parts.append(f"{len(degenerate)} degenerate (zero-variance): {degenerate}")
    if high_outlier:
        parts.append(
            f"{len(high_outlier)} over the outlier-fraction threshold "
            f"(worst {worst_outlier_fraction:.1%}): {high_outlier}"
        )
    return CheckResult(
        "statistical",
        False,
        "; ".join(parts) + ".",
        measured=worst_outlier_fraction if high_outlier else float(len(degenerate)),
        threshold=max_outlier_fraction,
        offenders=offenders,
    )


def check_completeness(
    df: pd.DataFrame, expected_tags: list[str] | None
) -> CheckResult:
    if expected_tags is None:
        return CheckResult(
            "completeness",
            True,
            "No expected tag list supplied — nothing to check against.",
            skipped=True,
        )
    present = set(tag_columns(df))
    missing = sorted(set(expected_tags) - present)
    if not missing:
        return CheckResult(
            "completeness", True, "Every expected tag is present."
        )
    return CheckResult(
        "completeness",
        False,
        f"{len(missing)} expected tag(s) missing from the artifact: {missing}.",
        measured=float(len(missing)),
        threshold=0.0,
        offenders=missing,
    )


# ── quality score (DS-LAKE-007-T03) ────────────────────────────────────────
#
# One point deduction per FAILED check, weighted by how structurally severe
# that check's failure is — NOT by how far over threshold it is. A degrees-
# of-failure formula (e.g. scaling the penalty by measured/threshold) would
# need every check to report a magnitude on the SAME scale to stay
# comparable, and they do not: `schema` is binary (a frame either has a
# timestamp column or it does not), while `missing_values`/`statistical`
# report a percentage and a fraction respectively. A fixed per-check weight
# sidesteps that mismatch and keeps the formula genuinely simple to state
# and test: "start at 100, subtract this check's weight for every check
# that failed, floor at 0."
#
# Weights sum to 100 so a PASS-all artifact scores 100 and a FAIL-all
# artifact scores 0. Ordered by how severe a failure of that kind is for a
# dataset that is about to be used for modelling:
CHECK_WEIGHTS: dict[str, float] = {
    "schema": 30.0,  # structurally broken — every other stat may be lying
    "missing_values": 20.0,  # too little real data to model against
    "duplicate_timestamps": 15.0,  # breaks time-series ordering assumptions
    "feature_consistency": 15.0,  # the recipe and the data have diverged
    "statistical": 10.0,  # a stuck sensor or extreme skew, not fatal alone
    "completeness": 10.0,  # missing tags, but present ones may still be usable
}


def compute_quality_score(checks: list[CheckResult]) -> float:
    """`100 - sum(CHECK_WEIGHTS[c.name] for c in checks if not c.passed)`,
    floored at 0. A SKIPPED check is, by this module's own convention,
    `passed=True` (see `check_feature_consistency`/`check_completeness`),
    so it costs nothing here either — "nothing to check against" is not a
    quality problem with the DATA.

    Deterministic (AC): a pure function of `checks`, no randomness, no wall
    clock, no I/O — the same report produces the same score every time,
    proven directly in `test_validation_service.py`.
    """
    penalty = sum(CHECK_WEIGHTS.get(c.name, 0.0) for c in checks if not c.passed)
    return max(0.0, 100.0 - penalty)


def run_validation(
    df: pd.DataFrame,
    *,
    feature_spec: Mapping[str, Any] | None = None,
    expected_tags: list[str] | None = None,
    max_missing_pct: float = DEFAULT_MAX_MISSING_PCT,
    max_outlier_fraction: float = DEFAULT_MAX_OUTLIER_FRACTION,
) -> dict[str, Any]:
    """Run every check and return the report `validation_report.json` holds.

    Order matters only for readability — every check runs regardless of an
    earlier one's result (AC: a per-check breakdown, not fail-fast), except
    that `check_schema` failing does not stop the others: a malformed frame
    still gets every check's own honest answer rather than a truncated
    report, since some checks (missing_values, statistical) tolerate the
    kind of malformation schema catches without crashing.
    """
    checks = [
        check_schema(df),
        check_duplicate_timestamps(df),
        check_missing_values(df, max_missing_pct),
        check_feature_consistency(df, feature_spec),
        check_statistical(df, max_outlier_fraction),
        check_completeness(df, expected_tags),
    ]
    failed = [c for c in checks if not c.passed]
    return {
        "status": "PASS" if not failed else "FAIL",
        "quality_score": compute_quality_score(checks),
        "checks": [c.to_dict() for c in checks],
        "failed_checks": [c.name for c in failed],
    }
