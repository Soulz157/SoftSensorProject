from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

# apps/python/config/env.py -> apps/python
_SERVICE_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _SERVICE_ROOT.parents[1]


class Settings(BaseSettings):
    APP_NAME: str = "SoftSensor API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    SECRET_KEY: str = "default-key"

    HOST: str = "0.0.0.0"
    PORT: int = 8000

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000", "https://softsensor.app"]
    CORS_ALLOW_CREDENTIALS: bool = True
    CORS_ALLOW_METHODS: List[str] = ["*"]
    CORS_ALLOW_HEADERS: List[str] = ["*"]

    INTERVAL_TIME: str = "1m"
    RANGE_TIME: int = 1

    SYS_USER: str
    SYS_PASS: str

    PI_NAME: str
    PI_API_SERVER: str = "https://scgc-piwebapi.scg.com/piwebapi/"
    CAL_TYPR: str = "Average"
    CAL_BASIS: str = "TimeWeighted"

    PI_VERIFY_SSL: bool = True
    PI_CA_BUNDLE: str | None = None   # path to corporate CA .pem; used when verify is on

    # MinIO / S3 — dataset version artifacts (Parquet). Defaults match the local
    # `minio-local` container; production supplies real values via the env.
    # Unlike SYS_USER / PI_NAME these are NOT required at import time, so a
    # machine with no object storage still imports and serves the PI endpoints.
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_BUCKET: str = "datasets"
    S3_REGION: str = "us-east-1"

    model_config = SettingsConfigDict(
        # root .env มาก่อน แล้ว apps/python/.env override ได้
        # `pnpm dev` ยิงผ่าน dotenvx (env มาทาง process อยู่แล้ว) แต่
        # `pnpm --filter python dev` รัน uvicorn ตรง ๆ โดย cwd = apps/python
        # ถ้าชี้แค่ ".env" เส้นทางหลังจะหา SYS_USER ไม่เจอ → Settings() พังตอน import
        # Anchored to this file, not the cwd. The relative form ("../../.env",
        # ".env") only resolved when the process happened to start in
        # apps/python, so running from the repo root — or pytest from anywhere
        # else — lost SYS_USER/SYS_PASS/PI_NAME and blew up at import. Same two
        # files, same precedence (root first, service-local overrides).
        env_file=(_REPO_ROOT / ".env", _SERVICE_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        # root .env มี key ของ client/backend ปนอยู่ (JWT_*, SMTP_*, DATABASE_URL)
        # ต้อง ignore ไม่งั้น pydantic-settings raise extra_forbidden ตอน import
        extra="ignore",
    )


settings = Settings()
