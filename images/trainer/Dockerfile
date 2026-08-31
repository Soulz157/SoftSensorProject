FROM python:3.12-slim

# libgomp1: lightgbm/xgboost dlopen libgomp.so.1 at import time for OpenMP;
# python:3.12-slim carries no apt packages at all, so without this the
# import fails inside build_model, after download + checksum verification.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 trainer
WORKDIR /app

# requirements ก่อน train.py — แก้โค้ดแล้ว pip layer ยัง cache อยู่
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY train.py /app/train.py
# MODEL-FLOW-009-T04. build_model's lstm/gru branch imports this by module
# name (`from sequence_model import SequenceRegressor`) — without this
# COPY the image builds fine and every other algorithm still works, and
# only an lstm/gru run fails with an ImportError, well after checksum
# verification, the exact "looks like it should work" gap this trainer's
# other guards are built to avoid.
COPY sequence_model.py /app/sequence_model.py

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
# invisible the moment the real tmpfs mounts over it. train.py's own
# `SCRATCH.mkdir(parents=True, exist_ok=True)` (its first line of work,
# main()) is what actually guarantees this exists and is writable, and it
# already runs before anything else touches the filesystem.

USER trainer
ENTRYPOINT ["python", "./train.py"]