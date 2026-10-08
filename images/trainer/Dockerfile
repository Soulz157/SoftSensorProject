FROM python:3.12-slim

# libgomp1: lightgbm/xgboost dlopen libgomp.so.1 at import time for OpenMP;
# python:3.12-slim carries no apt packages at all, so without this the
# import fails inside build_model, after download + checksum verification.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 trainer

# MODEL-SERVE-003. Build CONTEXT moved to the repo root — packages/py-
# scaling lives outside images/trainer, needed so pipelines/batch.py can
# apply the SAME fitted scaling transform apps/serving uses
# (decisions.serving_transform_is_an_extracted_module: one implementation,
# not two that could drift). WORKSPACE mirrors the monorepo's own relative
# layout — apps/serving/Dockerfile already made this exact move, for the
# identical reason: requirements.txt's `-e ../../packages/py-scaling` line
# is a relative path resolved against its own location, and changing the
# on-disk depth here would silently break that install with no error until
# the first import. See Dockerfile.dockerignore (co-located, BuildKit
# per-Dockerfile naming) for what keeps the repo-root context from sweeping
# in node_modules/.git/every local .venv.
WORKDIR /workspace

COPY packages/py-scaling /workspace/packages/py-scaling

# requirements ก่อนโค้ด — แก้โค้ดแล้ว pip layer ยัง cache อยู่
COPY images/trainer/requirements.txt /workspace/images/trainer/requirements.txt
WORKDIR /workspace/images/trainer
RUN pip install --no-cache-dir -r requirements.txt

# ONE COPY OF THE WHOLE PACKAGE, replacing the previous per-file COPY list.
#
# This is what the module split changes in this file, and it removes a real
# failure class rather than merely tidying: the per-file version needed a COPY
# line for `sequence_model.py` and carried a comment explaining that omitting it
# would build fine, leave every other algorithm working, and fail ONLY an
# lstm/gru run with an ImportError well after checksum verification. That gap
# scaled with the split — eighteen modules would have meant eighteen chances to
# forget one, each surfacing only on the code path that imports it.
#
# The trade-off is the mirror image and is handled by .dockerignore: a directory
# COPY ships whatever happens to be sitting in app/, so a scratch script or a
# stray .env would silently enter a production image. .dockerignore is therefore
# load-bearing here in a way it was not before — treat it as part of this
# Dockerfile, not as housekeeping.
COPY images/trainer/app/ /workspace/images/trainer/app/

# Byte-compile at BUILD time, and note the ordering: this must run before the
# PYTHONDONTWRITEBYTECODE ENV below, which would otherwise suppress it.
#
# PYTHONDONTWRITEBYTECODE was inert in the single-file version — CPython never
# caches __main__, so there was nothing to suppress. With eighteen imported
# modules it now does something real, and so does this line: the production
# container runs ReadonlyRootfs=true, so every import would otherwise attempt a
# write into /app/__pycache__, fail, and be silently ignored (bytecode write
# failures never raise). Compiling here means the cache is already present and
# read-only-friendly. The saving is small — tens of milliseconds against a fit
# measured in minutes — but the pointless write attempts go away entirely.
#
# COPY preserves mtimes and this runs immediately after, so the default
# timestamp-based invalidation matches and Python does not re-parse.
RUN python -m compileall -q /workspace/images/trainer/app \
    && chown -R trainer:trainer /workspace

ENV HOME=/scratch \
    MPLCONFIGDIR=/scratch/.mpl \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/scratch

# MODEL-FLOW-009-T04. LIVE-VERIFIED necessary, not precautionary: the
# production container runs with ReadonlyRootfs=true and only /scratch
# writable (trainning-container.authorized.service.ts) — /tmp sits on the
# read-only rootfs. sklearn/lightgbm/xgboost never needed a system temp
# dir, so this went uncaught until a REAL lstm run through the real
# container hit "[Errno 2] No usable temporary directory found in
# ['/tmp', '/var/tmp', '/usr/tmp', '/app']" (torch/joblib's tempfile use).
# Pointed straight at /scratch itself, NOT a subdirectory: /scratch is a
# tmpfs MOUNTED AT CONTAINER RUNTIME, which shadows anything baked into
# the image at that path — a `RUN mkdir -p /scratch/tmp` here would be
# invisible the moment the real tmpfs mounts over it.
#
# The guarantee that /scratch exists and is writable now comes from
# pipelines.run_training / pipelines.score.run_scoring / (MODEL-SERVE-003)
# pipelines.batch.run_batch_scoring — each calls `SCRATCH.mkdir(parents=True,
# exist_ok=True)` as its first line of work, before anything else touches the
# filesystem. Note "each": the single-file version had one mkdir in main(),
# and score mode reached it too. There are now THREE entrypoints and
# therefore three mkdir calls, one per entrypoint. If a fourth mode is ever
# added, it needs its own.

USER trainer

# sys.path[0] is the script's directory — which is what makes the package's
# flat absolute imports (`from labels import ...`, `import pipelines`)
# resolve identically here and under pytest (see conftest.py). WORKDIR set
# explicitly here (MODEL-SERVE-003's context move left the last WORKDIR at
# .../images/trainer, one level up) so `./train.py` below still resolves.
# Left as ./train.py rather than `-m train` to keep this line unchanged from
# the pre-split image.
WORKDIR /workspace/images/trainer/app
ENTRYPOINT ["python", "./train.py"]