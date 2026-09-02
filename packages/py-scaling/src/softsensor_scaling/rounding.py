"""JS-compatible rounding + Tukey hinge median. Moved verbatim from
`apps/python/services/cleaning_service.py:63-86` — canonical source is
here now; `cleaning_service.py` re-exports these same names so every
existing internal call in that module keeps working unchanged.
"""

from __future__ import annotations

import math
from typing import Sequence


def _js_round(value: float) -> float:
    """JavaScript `Math.round`: half rounds toward +Infinity.

    `Math.round(2.5) === 3` and `Math.round(-2.5) === -2`. Python's built-in
    `round` uses banker's rounding and returns 2 and -2, so every rounded
    cell could differ in its last decimal place.
    """
    if math.isnan(value) or math.isinf(value):
        return value
    return math.floor(value + 0.5)


def _round_to(value: float, precision: int) -> float:
    factor = 10**precision
    return _js_round(value * factor) / factor


def _median_sorted(sorted_values: Sequence[float]) -> float:
    n = len(sorted_values)
    if n == 0:
        return 0.0
    mid = n // 2
    hi = sorted_values[mid]
    return (sorted_values[mid - 1] + hi) / 2 if n % 2 == 0 else hi
