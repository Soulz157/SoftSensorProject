from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/serving/config/env.py -> apps/serving -> repo root
_SERVICE_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _SERVICE_ROOT.parents[1]


class Settings(BaseSettings):
    APP_NAME: str = "SoftSensor Serving"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    HOST: str = "0.0.0.0"
    PORT: int = 8100

    # NestJS backend base URL — the ONLY thing this process talks to besides
    # a presigned object URL. No DATABASE_URL, no S3_* credentials here on
    # purpose: this process holds neither Postgres nor MinIO access (see
    # decisions.serving_host_undecided's resolution and MODEL-SERVE-002's
    # descriptor-endpoint design) — the backend resolves everything and
    # hands back presigned URLs, matching the rule images/trainer/app/
    # storage.py states on itself.
    BACKEND_API_BASE: str = "http://localhost:4000"
    # Must match apps/backend's SERVING_API_TOKEN exactly — required, no
    # default, so a misconfigured deployment fails at startup rather than
    # every request failing with an opaque 401.
    SERVING_API_TOKEN: str

    # T02. Cache bounded by BYTES, not entry count — models differ in size
    # by orders of magnitude and a count-based cap sizes for the smallest
    # one. Default 512 MiB.
    SERVING_CACHE_MAX_BYTES: int = 512 * 1024 * 1024

    # T04. Cap rows per /predict request — bounded, synchronous by design.
    SERVING_MAX_ROWS: int = 1000

    # T07. decisions.serving_cache_staleness_bound — the maximum time a
    # promoted version can take to become live on this replica. A TTL on
    # the descriptor lookup, not an emergent property.
    SERVING_DESCRIPTOR_TTL_SECONDS: int = 30

    # MODEL-SERVE-005-T01. Whether THIS request gets logged at all — a coin
    # flip per /predict call, not a per-row sample within one request (a
    # sampled-out request produces no PredictionLog row and no object;
    # nothing about it is retained). 1.0 logs every request; 0 disables
    # logging entirely without touching a call site. A rate chosen by
    # accident makes every downstream statistic uninterpretable, so this
    # has no silent fallback — every logged row carries the rate that was
    # actually in force (PredictionLog.samplingRate), never re-derived from
    # this setting later.
    SERVING_LOG_SAMPLE_RATE: float = 1.0
    # Cap on RAW rows written to the Parquet object for one logged request —
    # independent of SERVING_MAX_ROWS (the request-size cap): a request can
    # be sampled IN yet still have its per-row detail trimmed, while the
    # aggregates (featureStats/predictionStats) are always computed over
    # every row, capped or not.
    SERVING_LOG_MAX_ROWS: int = 200
    # Bounds the best-effort backend POST — logging must never make
    # /predict wait longer than this, and a hung log call must not hold a
    # BackgroundTasks worker open indefinitely.
    SERVING_LOG_TIMEOUT_SECONDS: float = 5.0

    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _SERVICE_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        # Root .env carries client/backend/python keys too (JWT_*, SMTP_*,
        # DATABASE_URL, SYS_USER, ...) — same reason apps/python/config/
        # env.py ignores extras rather than raising on import.
        extra="ignore",
    )


settings = Settings()
