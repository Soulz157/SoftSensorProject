"""DS-LAKE-006-T04: `feature_spec.json` content and its hash's own contract.

The AC is specific: the hash must be STABLE for an identical configuration
and must CHANGE when any transform changes. Both halves are proven directly,
not asserted — a hash that changed on every call would trivially "change
when any transform changes" too, so stability under a byte-identical rebuild
is checked first, before any of the divergence tests would mean anything.
"""

from __future__ import annotations

import copy

from services.feature_spec_service import build_feature_spec, max_replay_lookback

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
        "scalingParams",
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


# ── target threading (MODEL-FLOW-000-T02) ──────────────────────────────────


def test_target_fields_absent_when_no_target_given() -> None:
    """The six AC fields are ALWAYS present; the three target fields are
    present ONLY when target_y is passed — never as null placeholders."""
    spec = _base_spec()
    assert "target_y" not in spec
    assert "target_scaled" not in spec
    assert "derived_from_target" not in spec


def test_target_fields_present_when_target_given() -> None:
    spec = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS),
        target_y="TI-101",
    )
    assert set(spec) == {
        "featureVersion", "features", "selectedColumns", "scaling",
        "scalingParams", "encoding", "featureHash", "target_y",
        "target_scaled", "derived_from_target",
    }
    assert spec["target_y"] == "TI-101"
    assert spec["target_scaled"] is True  # TI-101 has a minmax scaler in BASE_SCALERS
    assert spec["derived_from_target"] == ["TI-101__lag3"]


def test_target_scaled_is_explicit_false_when_unscaled() -> None:
    spec = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), {},
        target_y="TI-101",
    )
    assert spec["target_scaled"] is False


def test_derived_from_target_is_empty_when_nothing_reads_the_target() -> None:
    spec = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS),
        target_y="FI-404",  # not read by any BASE_FEATURES config
    )
    assert spec["derived_from_target"] == []


def test_derived_from_target_is_a_transitive_closure() -> None:
    """A later feature can read an earlier feature's own derived column —
    both must land in derived_from_target, not just the direct reader.
    Y__lag1 reads Y directly; Y__lag1__roll5 reads Y__lag1, not Y."""
    target = "Y"
    chained = [
        {"id": "f1", "kind": "lag", "tag": target, "k": 1},
        {
            "id": "f2", "kind": "rolling", "tag": "Y__lag1",
            "window": 5, "agg": "mean",
        },
    ]
    spec = build_feature_spec(chained, None, {}, target_y=target)
    assert spec["derived_from_target"] == sorted(["Y__lag1", "Y__lag1__roll5_mean"])


def test_target_fields_are_excluded_from_the_hash() -> None:
    """The hash describes how the artifact was BUILT, not how a run reads
    it — two runs with different targets against the same GOLD bytes must
    still share a featureHash."""
    no_target = _base_spec()
    with_target_a = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS),
        target_y="TI-101",
    )
    with_target_b = build_feature_spec(
        copy.deepcopy(BASE_FEATURES), list(BASE_SELECTED), dict(BASE_SCALERS),
        target_y="VI-202",
    )
    assert no_target["featureHash"] == with_target_a["featureHash"]
    assert with_target_a["featureHash"] == with_target_b["featureHash"]


# ── DS-LAKE-018-T04: max_replay_lookback ──────────────────────────────────


def test_max_replay_lookback_is_zero_for_features_with_no_lookback() -> None:
    assert max_replay_lookback([]) == 0
    assert max_replay_lookback(
        [{"id": "f1", "kind": "log", "tag": "TI-101"}]) == 0


def test_max_replay_lookback_reads_lag_k_and_rolling_window_directly() -> None:
    assert max_replay_lookback(
        [{"id": "f1", "kind": "lag", "tag": "TI-101", "k": 3}]) == 3
    assert max_replay_lookback(
        [{"id": "f1", "kind": "rolling", "tag": "TI-101", "window": 60,
          "agg": "mean"}]
    ) == 60
    assert max_replay_lookback(
        [{"id": "f1", "kind": "delta", "tag": "TI-101"}]) == 1


def test_max_replay_lookback_compounds_a_lag_of_a_rolling_column() -> None:
    """The scope_note's own worked example: lag(5) of rolling(60) needs 65,
    not 5 — reading only the outermost config would silently under-count."""
    chained = [
        {"id": "f1", "kind": "rolling", "tag": "TI-101", "window": 60,
         "agg": "mean"},
        {"id": "f2", "kind": "lag", "tag": "TI-101__roll60_mean", "k": 5},
    ]
    assert max_replay_lookback(chained) == 65


def test_max_replay_lookback_compounds_through_a_formula_var() -> None:
    """A `formula` config's `vars` mapping can ALSO read a derived column —
    must compound exactly like `tag`/`tags` do, not be treated as
    lookback-free just because `formula` itself has none."""
    chained = [
        {"id": "f1", "kind": "lag", "tag": "TI-101", "k": 10},
        {
            "id": "f2", "kind": "formula", "expr": "c0 * 2",
            "vars": {"c0": "TI-101__lag10"},
        },
    ]
    assert max_replay_lookback(chained) == 10


def test_max_replay_lookback_takes_the_deeper_of_several_independent_chains() -> None:
    chains = [
        {"id": "f1", "kind": "lag", "tag": "TI-101", "k": 3},
        {"id": "f2", "kind": "rolling", "tag": "VI-202", "window": 20,
         "agg": "mean"},
        {"id": "f3", "kind": "delta", "tag": "FI-404"},
    ]
    assert max_replay_lookback(chains) == 20


def test_max_replay_lookback_does_not_compound_across_independent_tags() -> None:
    """A rolling(60) on ONE tag must not inflate the lookback of an
    unrelated lag(3) on a DIFFERENT tag — compounding only follows an
    actual tag-name match through `_reads_tags`."""
    independent = [
        {"id": "f1", "kind": "rolling", "tag": "TI-101", "window": 60,
         "agg": "mean"},
        {"id": "f2", "kind": "lag", "tag": "VI-202", "k": 3},
    ]
    assert max_replay_lookback(independent) == 60
