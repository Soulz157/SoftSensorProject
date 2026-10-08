"""DS-LAKE-028-V06. Replay a real pre-feature training run under the NEW
trainer image and assert its metrics are unchanged.

Runs INSIDE the 1.0.13 container so the code under test is the shipped image,
not the host tree. The run spec, the artifact bytes and the feature_spec are
the recorded ones — a legacy spec (`scaling: []`, populated scalingParams).
"""
import json, sys, types
sys.path.insert(0, "/workspace/images/trainer/app")

run = json.load(open("/replay/run.json"))
expected = run["metrics"]

from config import RunContext
import pipelines

spec = {
    "targetY": run["targetY"],
    "algorithm": run["algorithm"],
    "seed": run["seed"],
    "hyperparameters": run["hyperparameters"],
    "splitSpec": run["splitSpec"],
    "artifactChecksum": run["artifactChecksum"],
    "dataUrl": "file:///replay/data.parquet",
    "featureSpecUrl": "file:///replay/feature_spec.json",
}
# Part of the REAL claim payload (model-run.authorized.service.ts:268). A
# sweep run trains on a SUBSET of the artifact's columns, so omitting this
# silently replays a different model — which is what a first run of this
# harness did (feature_count 21 vs the recorded 5).
if run.get("featureColumns"):
    spec["featureColumns"] = run["featureColumns"]

class StubApi:
    """Only the callbacks _prepare/_select_strategy/strategy actually use."""
    def claim(self): return spec
    def log(self, message, level="info"): print(f"[{level}] {message}", flush=True)
    def report_step(self, *a, **k): pass
    def progress(self, *a, **k): pass
    def __getattr__(self, name):  # any other callback is a no-op here
        return lambda *a, **k: None

# `download` fetches over HTTP; the bytes are already local and their
# checksum is still verified by download_verified, which is the property
# that matters (a wrong artifact would fail there).
import storage
from pathlib import Path
import shutil
def _local_download(url, dest):
    src = url.replace("file://", "")
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)
    return Path(dest)
storage.download = _local_download
pipelines.download = _local_download
pipelines.download_verified = storage.download_verified

api = StubApi()
prepared = pipelines._prepare(api)
strategy = pipelines._select_strategy(prepared, api)
result = strategy(prepared, api)
actual = result.metrics

print("\n=== V06 ===")
keys = sorted(set(expected) | set(actual))
bad = []
for k in keys:
    e, a = expected.get(k), actual.get(k)
    same = (e == a) or (
        isinstance(e, float) and isinstance(a, float) and abs(e - a) <= 1e-9 * max(1.0, abs(e))
    )
    print(f"{'OK ' if same else 'DIFF'} {k}: recorded={e} replayed={a}")
    if not same:
        bad.append(k)
print("\nRESULT:", "METRICS UNCHANGED" if not bad else f"CHANGED: {bad}")
sys.exit(1 if bad else 0)
