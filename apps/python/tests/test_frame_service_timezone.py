"""MODEL-SERVE-032-T02. Wall-clock <-> UTC conversion at the write-back edge.

Frames hold naive Bangkok digits; PI / Postgres / the API hold UTC. A 7h slip
here would read the "before" snapshot from the wrong hours and make a
rollback restore the wrong values, so the inverse is pinned in both
directions and at the day boundary.
"""

from __future__ import annotations

import pandas as pd
import pytest

from services.frame_service import utc_iso, utc_to_wall_clock, wall_clock_to_utc


def test_naive_bangkok_digits_become_utc_minus_seven() -> None:
    assert wall_clock_to_utc("2026-10-14 07:00:00") == pd.Timestamp(
        "2026-10-14 00:00:00", tz="UTC"
    )


def test_crosses_the_day_boundary_backwards() -> None:
    # 03:30 Bangkok on the 14th is 20:30 UTC on the 13th.
    assert wall_clock_to_utc("2026-10-14 03:30:00") == pd.Timestamp(
        "2026-10-13 20:30:00", tz="UTC"
    )


@pytest.mark.parametrize(
    "instant",
    [
        "2026-10-14T00:00:00Z",
        "2026-10-13T20:30:00Z",
        "2026-12-31T17:00:00Z",  # new year already in Bangkok
        "2026-01-01T00:00:00Z",
    ],
)
def test_round_trip_utc_to_wall_clock_and_back_is_identity(instant: str) -> None:
    t = pd.Timestamp(instant)
    assert wall_clock_to_utc(utc_to_wall_clock(t)) == t


def test_round_trip_wall_clock_to_utc_and_back_is_identity() -> None:
    naive = pd.Timestamp("2026-10-14 12:15:00")
    assert utc_to_wall_clock(wall_clock_to_utc(naive)) == naive


def test_aware_input_is_a_real_instant_only_normalised() -> None:
    aware = pd.Timestamp("2026-10-14 07:00:00+07:00")
    assert wall_clock_to_utc(aware) == pd.Timestamp("2026-10-14 00:00:00", tz="UTC")


def test_utc_iso_has_literal_z_and_milliseconds() -> None:
    assert utc_iso("2026-10-14 07:00:00") == "2026-10-14T00:00:00.000Z"
    assert utc_iso("2026-10-14 07:00:00.250") == "2026-10-14T00:00:00.250Z"


def test_utc_iso_is_not_a_bare_z_suffix_on_bangkok_digits() -> None:
    # The named trap: stamping the naive digits with Z would read 07:00.
    assert not utc_iso("2026-10-14 07:00:00").startswith("2026-10-14T07")
