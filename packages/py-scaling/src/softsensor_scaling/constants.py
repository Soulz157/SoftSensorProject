"""Status-column conventions. Moved verbatim from
`apps/python/intergrations/object_store.py:55-66,180-199` — canonical
source is here now; `object_store.py` re-exports these same names so every
existing `from intergrations.object_store import STATUS_GOOD` (etc.) call
in `apps/python` keeps working unchanged.
"""

from __future__ import annotations

import pandas as pd

# Suffix reserved for the status sidecar column. A real tag named
# `FOO__status` would collide with `FOO`'s status column and silently
# corrupt it, so writes reject it rather than trusting that PI never
# produces such a name.
STATUS_SUFFIX = "__status"

TIMESTAMP_COLUMN = "timestamp"

STATUS_GOOD = 0
STATUS_BAD = 1
STATUS_QUESTIONABLE = 2


def _tags_from_columns(columns: list[str]) -> list[str]:
    return [
        c for c in columns if c != TIMESTAMP_COLUMN and not c.endswith(STATUS_SUFFIX)
    ]


def tag_columns(df: pd.DataFrame) -> list[str]:
    """Logical tags only — excludes `timestamp` and every status sidecar.

    `columnCount` on the artifact row and the preview's "feature count" must
    both use this definition or they disagree on screen: the frame carries
    2N+1 physical columns for N logical tags.
    """
    return _tags_from_columns(list(df.columns))


def status_column(tag: str) -> str:
    return f"{tag}{STATUS_SUFFIX}"
