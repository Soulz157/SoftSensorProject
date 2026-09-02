FROM python:3.12-slim

# libgomp1: lightgbm/xgboost dlopen libgomp.so.1 at import time for OpenMP;
# python:3.12-slim carries no apt packages at all, so without this the
# import fails inside build_model, after download + checksum verification.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 trainer
WORKDIR /app

# requirements ก่อนโค้ด — แก้โค้ดแล้ว pip layer ยัง cache อยู่
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

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
COPY app/ /app/

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
RUN python -m compileall -q /app && chown -R trainer:trainer /app

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
# pipelines.run_training / pipelines.score.run_scoring — each calls
# `SCRATCH.mkdir(parents=True, exist_ok=True)` as its first line of work, before
# anything else touches the filesystem. Note "each": the single-file version had
# one mkdir in main(), and score mode reached it too. After the split there are
# two entrypoints and therefore two mkdir calls, one per entrypoint. If a third
# mode is ever added, it needs its own.

USER trainer

# sys.path[0] is the script's directory, i.e. /app — which is what makes the
# package's flat absolute imports (`from labels import ...`, `import pipelines`)
# resolve identically here and under pytest (see conftest.py). Left as
# ./train.py rather than `-m train` to keep this line unchanged from the
# pre-split image.
ENTRYPOINT ["python", "./train.py"]