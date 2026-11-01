"""Dev-only: build the Monitoring-tab fixture for a document mockup.

Every number comes from the fake PI Web API's own generator
(`fake_pi_webapi.py`), shaped the way the scheduler would see it:

* inputs  — each base tag's hourly PI ``Average`` summary (the dataset's own
  fetch config: Average / TimeWeighted / 1h), then the dataset's recorded
  feature recipes applied by the project's real ``feature_service``;
* output  — the model's PRODUCTION ``model.joblib`` scoring those features,
  min-max scaled with the training range recorded in ``psiRefEdges``;
* actual  — the lab tag's recorded values (one per 4 h, as PI returns them).

Usage (from apps/python) — three steps, because the app venv has no
scikit-learn and the model scores in the trainer image (as in production):
  .venv/bin/python dev/monitoring_mockup_fixture.py build <dataset_cfg.json> <workdir>
  docker run --rm -v <workdir>:/w --entrypoint python scgc/soft-sensor-trainer:1.0.23 \
    -c "import joblib,numpy;m=joblib.load('/w/model.joblib');numpy.save('/w/pred.npy',m.predict(numpy.load('/w/X.npy')))"
  .venv/bin/python dev/monitoring_mockup_fixture.py merge <workdir> <out.json>

Add ``--clean-lab`` to ``build`` for a document-friendly Actual: the lab
value from the fake's clean process signal — no injected bad result, no
measurement noise — sampled EVERY HOUR, so each window is a measured pair
and the chart shows Actual and Predict as two lines with a residual per
hour (``pairsOnly``: the client then drops the scheduled and held series).
Inputs stay as PI serves them (spikes and dropouts included), so the
predictions are still the model's real output.

Nothing here writes to the database or the object store.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dependencies import get_object_store  # noqa: E402
from services.feature_service import apply_features  # noqa: E402
import fake_pi_webapi as fake  # noqa: E402

GOLD = (
    "755b962d-4853-4476-ae6f-c70335b792d2/artifacts/"
    "bbf2db7d-d68e-403f-8b33-0f63d7c734f4"
)
# The model's own FINAL (`GOLD` above) was re-committed from an already
# scaled GOLD, so its spec lost the recipes and records [0,1] ranges. The
# first FINAL holds the real raw-unit training ranges and scaler params —
# the transform the model's training rows actually went through.
RANGES = (
    "755b962d-4853-4476-ae6f-c70335b792d2/artifacts/"
    "bc8606d0-f82f-4588-b54a-d699d665e41a"
)
RUN = "drafts/fc5e712c-2ccd-4573-b73e-1b53efd1361a/runs/ed9a6a9a-52f6-4e42-821c-bfc52f18ae61"
TARGET = "S204IBP.lab"
DAYS = 31
WARMUP_HOURS = 30  # longest lag/roll is 24 h


def _clean_lab(tag: str, t: datetime) -> float:
    """The lab's process value at `t`: no injected bad result, no
    measurement noise, and not held over the fake's 4 h lab interval."""
    _d, _u, base, mix = fake.LAB_TAGS[fake._canon(tag)]
    ts = t.timestamp()
    return round(base + sum(fake._raw(s, ts, clean=True) * w for s, w in mix), 1)


def build(cfg_path: str, workdir: str, clean_lab: bool = False) -> None:
    work = Path(workdir)
    store = get_object_store()
    spec = json.loads(store.get_object_bytes(f"{RANGES}/feature_spec.json"))
    manifest = json.loads(store.get_object_bytes(f"{RUN}/run_manifest.json"))
    (work / "model.joblib").write_bytes(store.get_object_bytes(f"{RUN}/model.joblib"))
    cfg = json.loads(Path(cfg_path).read_text())

    feature_columns: list[str] = manifest["feature_columns"]
    base_tags = [t for t in cfg["baseTags"] if t != TARGET]

    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=DAYS, hours=WARMUP_HOURS)
    hours = pd.date_range(start, end - timedelta(hours=1), freq="1h", tz="UTC")
    step = timedelta(hours=1)

    frame = pd.DataFrame({"timestamp": hours.tz_convert(None)})
    for tag in base_tags:
        frame[tag] = [
            float(fake._summary(tag, "Average", h.to_pydatetime(), step))
            for h in hours
        ]
        frame[f"{tag}__status"] = pd.array([0] * len(hours), dtype="int8")
    frame = apply_features(frame, cfg["features"])

    missing = [c for c in feature_columns if c not in frame.columns]
    if missing:
        raise SystemExit(f"recipes did not produce: {missing[:5]}")

    edges = spec.get("psiRefEdges", {})
    params = spec.get("scalingParams", {})
    cols = {}
    for col in feature_columns:
        x = frame[col].astype(float)
        p = params.get(col)
        if p and p["max"] > p["min"]:
            x = (x - p["min"]) / (p["max"] - p["min"])
        cols[col] = x.fillna(0.0)
    scaled = pd.DataFrame(cols, index=frame.index)

    keep = frame.index[WARMUP_HOURS:]
    np.save(work / "X.npy", scaled.loc[keep, feature_columns].to_numpy())

    lab_step = timedelta(hours=1) if clean_lab else fake.LAB_HOLD
    sec = lab_step.total_seconds()
    first = datetime.fromtimestamp(
        math.ceil(hours[WARMUP_HOURS].timestamp() / sec) * sec, timezone.utc
    )
    lab = []
    t = first
    while t < end:
        value = _clean_lab(TARGET, t) if clean_lab else fake.value_at(TARGET, t)
        lab.append([t.isoformat().replace("+00:00", "Z"), value])
        t += lab_step

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "cleanLab": clean_lab,
        "pairsOnly": clean_lab,
        "target": TARGET,
        "featureColumns": feature_columns,
        "hours": [
            h.isoformat().replace("+00:00", "Z") for h in hours[WARMUP_HOURS:]
        ],
        "features": {
            c: [
                None if pd.isna(v) else round(float(v), 4)
                for v in frame.loc[keep, c]
            ]
            for c in feature_columns
        },
        "lab": lab,
        "ref": {
            c: {
                "edges": edges.get(c),
                "counts": spec.get("psiRefCounts", {}).get(c),
                "binMode": spec.get("psiBinMode", {}).get(c, "continuous"),
            }
            for c in feature_columns
            if edges.get(c)
        },
        "targetRef": {
            "edges": edges.get(TARGET),
            "counts": spec.get("psiRefCounts", {}).get(TARGET),
        },
    }
    (work / "fixture.partial.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(out['hours'])} h, {len(feature_columns)} features, {len(lab)} lab points")


def merge(workdir: str, out_path: str) -> None:
    work = Path(workdir)
    out = json.loads((work / "fixture.partial.json").read_text())
    pred = np.load(work / "pred.npy")
    if len(pred) != len(out["hours"]):
        raise SystemExit(f"{len(pred)} predictions for {len(out['hours'])} hours")
    out["pred"] = [round(float(p), 3) for p in pred]
    Path(out_path).write_text(json.dumps(out, separators=(",", ":")))
    print(f"pred {pred.min():.1f}..{pred.max():.1f} mean {pred.mean():.1f}")


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2], sys.argv[3], clean_lab="--clean-lab" in sys.argv[4:])
    else:
        merge(sys.argv[2], sys.argv[3])
