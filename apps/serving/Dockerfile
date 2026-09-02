FROM python:3.12-slim

# MODEL-SERVE-002-T01. MUST stay python:3.12-slim and match
# images/trainer/requirements.txt's exact pandas/numpy/scikit-learn/joblib
# pins (see apps/serving/requirements.txt's own comment) — this process
# unpickles model.joblib objects the trainer image wrote, and a mismatched
# runtime cannot be trusted to unpickle them correctly.

# libgomp1: lightgbm/xgboost dlopen libgomp.so.1 at import time for OpenMP —
# same requirement as images/trainer/Dockerfile, same reason.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 serving

# Build CONTEXT is the repo root, not this directory — packages/py-scaling
# lives outside apps/serving. WORKSPACE mirrors the monorepo's own relative
# layout (rather than flattening everything into /app) because
# requirements.txt's `-e ../../packages/py-scaling` line is a relative path
# resolved against its own location; changing the on-disk depth here would
# silently break that install with no error until the first import.
WORKDIR /workspace

COPY packages/py-scaling /workspace/packages/py-scaling

# requirements before the rest of the app code — the pip layer stays
# cached across app-only edits, same ordering images/trainer/Dockerfile uses.
COPY apps/serving/requirements.txt /workspace/apps/serving/requirements.txt
WORKDIR /workspace/apps/serving
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

COPY apps/serving/ /workspace/apps/serving/

RUN chown -R serving:serving /workspace

ENV PYTHONUNBUFFERED=1

USER serving

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
