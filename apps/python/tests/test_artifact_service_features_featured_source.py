"""DS-LAKE-042. `artifact_service.features` refuses a source that already
carries the recipe's generated feature columns.

Live 2026-11-02: an edit-mode save ran the FEATURE job on the draft's
previous GOLD instead of its BRONZE. Every lag config collided with a column
already present, `apply_features` skipped each one, and the feature spec it
wrote listed no features while the data kept 108 lag columns — the dataset
trained, then could not be deployed.
"""

from __future__ import annotations

import pytest

from schemas.preprocess import FeatureConfigRequest, FeaturesRequest
from services import artifact_service
from tests.test_artifact_service import RecordingStore, frame

SRC = "ds-1/artifacts/bronze-id/data.parquet"
GOLD = "ds-1/artifacts/gold-id/data.parquet"
GOLD2 = "ds-1/artifacts/gold2-id/data.parquet"
LAG = [FeatureConfigRequest(id="f1", kind="lag", tag="TI-101", k=1)]


def _features(store, source_key, target_key, features):
    return artifact_service.features(
        store,
        FeaturesRequest(
            source_key=source_key, target_key=target_key, features=features
        ),
    )


def test_raw_source_computes_the_feature_and_records_it():
    store = RecordingStore({SRC: frame()})
    _features(store, SRC, GOLD, LAG)
    assert "TI-101__lag1" in store.objects[GOLD].columns
    spec = store.documents["ds-1/artifacts/gold-id/feature_spec.json"]
    assert len(spec["features"]) == 1


def test_rerunning_on_the_featured_output_is_refused_not_skipped():
    store = RecordingStore({SRC: frame()})
    _features(store, SRC, GOLD, LAG)
    with pytest.raises(ValueError, match="already contains 1 feature column"):
        _features(store, GOLD, GOLD2, LAG)
    # Nothing written for the refused run — no spec claiming zero features.
    assert GOLD2 not in store.objects
    assert "ds-1/artifacts/gold2-id/feature_spec.json" not in store.documents


def test_a_user_named_formula_colliding_with_a_tag_still_skips_silently():
    """The deliberate collision apply_features keeps: a preset formula named
    like a real tag. Not a featured source, so not refused."""
    store = RecordingStore({SRC: frame()})
    formula = [
        FeatureConfigRequest(id="f1", kind="formula", name="TI-101", expr="1")
    ]
    result = _features(store, SRC, GOLD, formula)
    assert result["skipped_features"] == ["TI-101"]
