"""Normalise source payloads into the canonical value+status frame.

Two incompatible wire shapes reach this service and converge here:

* **PI is tag-major** (`schemas/data.py` `DataFetchResponse`) — one independent
  series per tag, each with its own timestamps. There is no shared time axis
  and no guarantee two tags sampled the same instants.
* **SQL is row-major** (`schemas/data_source.py` `SQLQueryResponse`) — already
  aligned rows of `{column: value}`.

Canonical output (see `intergrations/object_store`):

    timestamp        datetime, naive Bangkok local (matches the PI connector)
    {tag}            double
    {tag}__status    int8  0=Good, 1=Bad, 2=Questionable

The missing-cell convention is inherited from the browser and must not be
"improved": a hole becomes ``{value: 0.0, status: Bad}`` — never NaN, never a
dropped row. The client's `piResponseToDataset` and `mergeDataset` do exactly
this, and the cleaning ops downstream depend on Bad cells existing so `drop`
and the fills have something to act on.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Sequence

import pandas as pd

from intergrations.object_store import (
    STATUS_BAD,
    STATUS_GOOD,
    STATUS_QUESTIONABLE,
    TIMESTAMP_COLUMN,
    assert_frame_shape,
    assert_tags_are_storable,
    status_column,
)

# A hole is a real, addressable Bad cell — not NaN, not an absent row.
MISSING_VALUE = 0.0


def _coerce_value(raw: Any) -> tuple[float, bool]:
    """Return (value, is_numeric).

    PI returns `float | str | None`: digital-state tags and errors arrive as
    strings. Those are not numbers, so they become Bad holes rather than
    poisoning the column with NaN.
    """
    if raw is None:
        return MISSING_VALUE, False
    if isinstance(raw, bool):  # bool subclasses int — reject before the numeric check
        return MISSING_VALUE, False
    if isinstance(raw, (int, float)):
        value = float(raw)
        if math.isnan(value) or math.isinf(value):
            return MISSING_VALUE, False
        return value, True
    try:
        value = float(str(raw).strip())
    except (TypeError, ValueError):
        return MISSING_VALUE, False
    if math.isnan(value) or math.isinf(value):
        return MISSING_VALUE, False
    return value, True


def _normalise_timestamp(raw: Any) -> pd.Timestamp | None:
    ts = pd.to_datetime(raw, errors="coerce")
    if ts is pd.NaT or pd.isna(ts):
        return None
    # PI hands back naive Bangkok local time (aveva_connect tz_converts, then
    # tz_localize(None)). Anything tz-aware is converted and flattened so one
    # artifact never mixes aware and naive stamps.
    if ts.tzinfo is not None:
        ts = ts.tz_convert("Asia/Bangkok").tz_localize(None)
    return ts


def _empty_frame(tags: Sequence[str]) -> pd.DataFrame:
    data: dict[str, Any] = {TIMESTAMP_COLUMN: pd.Series([], dtype="datetime64[ns]")}
    for tag in tags:
        data[tag] = pd.Series([], dtype="float64")
        data[status_column(tag)] = pd.Series([], dtype="int8")
    return pd.DataFrame(data)


def _finalise(
    timestamps: list[pd.Timestamp],
    values: Mapping[str, list[float]],
    statuses: Mapping[str, list[int]],
    tags: Sequence[str],
) -> pd.DataFrame:
    data: dict[str, Any] = {TIMESTAMP_COLUMN: timestamps}
    for tag in tags:
        data[tag] = values[tag]
        data[status_column(tag)] = pd.array(statuses[tag], dtype="int8")

    frame = pd.DataFrame(data)
    frame = frame.sort_values(TIMESTAMP_COLUMN, kind="stable").reset_index(drop=True)
    assert_frame_shape(frame)
    return frame


def from_pi_response(payload: Mapping[str, Any]) -> pd.DataFrame:
    """Tag-major PI response -> canonical frame.

    Each tag carries its own timestamps, so the frame is built on the UNION of
    every tag's stamps. A tag with no sample at a given instant gets a Bad hole
    there — that is what makes the grid rectangular without inventing readings.
    """
    results: Iterable[Mapping[str, Any]] = payload.get("results") or []

    tags: list[str] = []
    per_tag: dict[str, dict[pd.Timestamp, tuple[float, int]]] = {}

    for result in results:
        tag = str(result.get("tag_name", "")).strip()
        if not tag:
            continue
        if tag not in per_tag:
            tags.append(tag)
            per_tag[tag] = {}

        # A failed tag still occupies a column — all Bad — so the dataset keeps
        # its shape and the failure stays visible instead of vanishing.
        tag_failed = result.get("status") == "failed"

        for point in result.get("data") or []:
            ts = _normalise_timestamp(point.get("timestamp"))
            if ts is None:
                continue
            value, numeric = _coerce_value(point.get("value"))
            if tag_failed or not numeric:
                per_tag[tag][ts] = (MISSING_VALUE, STATUS_BAD)
            else:
                per_tag[tag][ts] = (value, STATUS_GOOD)

    assert_tags_are_storable(tags)

    if not tags:
        return _empty_frame(tags)

    timeline = sorted({ts for points in per_tag.values() for ts in points})
    if not timeline:
        return _empty_frame(tags)

    values: dict[str, list[float]] = {t: [] for t in tags}
    statuses: dict[str, list[int]] = {t: [] for t in tags}

    for ts in timeline:
        for tag in tags:
            value, status = per_tag[tag].get(ts, (MISSING_VALUE, STATUS_BAD))
            values[tag].append(value)
            statuses[tag].append(status)

    return _finalise(timeline, values, statuses, tags)


def from_sql_response(
    payload: Mapping[str, Any],
    timestamp_column: str,
    tags: Sequence[str] | None = None,
) -> pd.DataFrame:
    """Row-major SQL response -> canonical frame.

    Rows are already aligned, so there is no union to compute. Anything that
    parses as a number is Good; anything else becomes a Bad hole, matching the
    PI path and the browser's CSV parser.
    """
    columns: list[str] = [str(c) for c in (payload.get("columns") or [])]
    rows: list[Mapping[str, Any]] = list(payload.get("rows") or [])

    if timestamp_column not in columns:
        raise ValueError(
            f"Timestamp column {timestamp_column!r} is not in the result set. "
            f"Available columns: {columns}"
        )

    selected = list(tags) if tags else [c for c in columns if c != timestamp_column]
    missing = [t for t in selected if t not in columns]
    if missing:
        raise ValueError(
            f"Requested columns are not in the result set: {sorted(missing)}. "
            f"Available columns: {columns}"
        )

    assert_tags_are_storable(selected)

    if not rows or not selected:
        return _empty_frame(selected)

    timestamps: list[pd.Timestamp] = []
    values: dict[str, list[float]] = {t: [] for t in selected}
    statuses: dict[str, list[int]] = {t: [] for t in selected}

    for row in rows:
        ts = _normalise_timestamp(row.get(timestamp_column))
        if ts is None:
            # A row with no usable timestamp cannot be placed on the axis, and
            # keeping it would corrupt every time-ordered operation.
            continue
        timestamps.append(ts)
        for tag in selected:
            value, numeric = _coerce_value(row.get(tag))
            values[tag].append(value)
            statuses[tag].append(STATUS_GOOD if numeric else STATUS_BAD)

    if not timestamps:
        return _empty_frame(selected)

    return _finalise(timestamps, values, statuses, selected)


def mark_questionable(
    frame: pd.DataFrame, tag: str, mask: Sequence[bool]
) -> pd.DataFrame:
    """Flag cells Questionable without changing their values.

    PI quality flags arrive separately from the summary read, so this applies
    them after the frame is built.
    """
    column = status_column(tag)
    if column not in frame.columns:
        raise ValueError(f"Unknown tag {tag!r}")
    if len(mask) != len(frame):
        raise ValueError("mask length must match the frame row count")

    # Select POSITIONALLY, never by label. `.loc[[1, 0, 0]]` on a raw sequence
    # is read by pandas as row LABELS, so an int mask meaning "row 0 only"
    # silently marks rows 1 and 0 instead — wrong cells, no error. Resolving
    # through `frame.index[...]` first makes the selection positional and works
    # on any index, including one left non-contiguous by an upstream row drop.
    positions = [bool(flag) for flag in mask]

    out = frame.copy()
    out.loc[out.index[positions], column] = STATUS_QUESTIONABLE
    return out
