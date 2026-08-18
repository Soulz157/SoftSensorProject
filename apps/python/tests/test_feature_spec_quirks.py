"""DS-LAKE-006-T04: `feature_spec.json` content and its hash's own contract.

The AC is specific: the hash must be STABLE for an identical configuration
and must CHANGE when any transform changes. Both halves are proven directly,
not asserted — a hash that changed on every call would trivially "change
when any transform changes" too, so stability under a byte-identical rebuild
is checked first, before any of the divergence tests would mean anything.
"""

from __future__ import annotations

import copy

from services.feature_spec_service import build_feature_spec

BASE_FEATURES = [
    {"id": "f1", "kind": "lag", "tag": "TI-101", "k": 3},
    {"id": "f2", "kind": "rolling", "tag": "VI-202", "window": 5, "agg": "mean"},
]
BASE_SELECTED = ["TI-101", "VI-202", "TI-101__lag3"]
BASE_SCALERS = {"TI-101": "minmax", "VI-202": "standard"}


def _base_spec() -> dict:
    return build_feature_spec(BASE_FEATURES, BASE_SELECTED, BASE_SCALERS)


# ── stability ──────────────────────────────────────────────────────────────


def test_hash_is_stable_for_an_identical_configuration() -> None:
    a = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS)
    )
    b = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS)
    )
    assert a["featureHash"] == b["featureHash"]
    assert a == b


def test_hash_is_stable_regardless_of_dict_key_insertion_order() -> None:
    """A config dict built with keys in a different order is the SAME
    config — the hash must not depend on Python dict insertion order."""
    reordered = [
        {"k": 3, "tag": "TI-101", "id": "f1", "kind": "lag"},
        {"agg": "mean", "window": 5, "tag": "VI-202", "id": "f2", "kind": "rolling"},
    ]
    reordered_scalers = {"VI-202": "standard", "TI-101": "minmax"}
    out = build_feature_spec(reordered, list(BASE_SELECTED), reordered_scalers)
    assert out["featureHash"] == _base_spec()["featureHash"]


# ── sensitivity: changes when ANY transform changes ────────────────────────


def test_hash_changes_when_a_feature_config_field_changes() -> None:
    changed = copy.deepcopy(BASE_FEATURES)
    changed[0]["k"] = 4  # lag depth 3 -> 4
    out = build_feature_spec(changed, list(BASE_SELECTED), dict(BASE_SCALERS))
    assert out["featureHash"] != _base_spec()["featureHash"]


def test_hash_changes_when_feature_order_changes() -> None:
    """Order is semantically meaningful (chaining) — swapping two configs
    with no other change must still change the hash."""
    reordered = [BASE_FEATURES[1], BASE_FEATURES[0]]
    out = build_feature_spec(reordered, list(BASE_SELECTED), dict(BASE_SCALERS))
    assert out["featureHash"] != _base_spec()["featureHash"]


def test_hash_changes_when_a_scaler_changes() -> None:
    changed_scalers = dict(BASE_SCALERS)
    changed_scalers["TI-101"] = "robust"
    out = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), changed_scalers
    )
    assert out["featureHash"] != _base_spec()["featureHash"]


def test_hash_changes_when_selected_columns_change() -> None:
    changed = list(BASE_SELECTED) + ["FI-404"]
    out = build_feature_spec(copy.deepcopy(BASE_FEATURES), changed, dict(BASE_SCALERS))
    assert out["featureHash"] != _base_spec()["featureHash"]


def test_hash_distinguishes_null_selection_from_empty_selection() -> None:
    """`None` (keep everything) and `[]` (keep nothing) are opposite ends of
    the spectrum, not two spellings of the same thing."""
    keep_all = build_feature_spec(copy.deepcopy(BASE_FEATURES), None, dict(BASE_SCALERS))
    keep_none = build_feature_spec(copy.deepcopy(BASE_FEATURES), [], dict(BASE_SCALERS))
    assert keep_all["featureHash"] != keep_none["featureHash"]
    assert keep_all["selectedColumns"] is None
    assert keep_none["selectedColumns"] == []


# ── content shape ────────────────────────────────────────────────────────


def test_spec_content_matches_the_ac_fields() -> None:
    spec = _base_spec()
    assert set(spec) == {
        "featureVersion",
        "features",
        "selectedColumns",
        "scaling",
        "encoding",
        "featureHash",
    }
    assert spec["features"][0]["name"] == "TI-101__lag3"
    assert spec["features"][1]["name"] == "VI-202__roll5_mean"
    assert spec["encoding"] == [], (
        "no categorical encoding exists in the ported transform set — an "
        "honest empty list, not an invented scheme"
    )
    assert isinstance(spec["featureHash"], str) and len(spec["featureHash"]) == 64
