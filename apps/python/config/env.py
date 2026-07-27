from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


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

    model_config = SettingsConfigDict(
        # root .env มาก่อน แล้ว apps/python/.env override ได้
        # `pnpm dev` ยิงผ่าน dotenvx (env มาทาง process อยู่แล้ว) แต่
        # `pnpm --filter python dev` รัน uvicorn ตรง ๆ โดย cwd = apps/python
        # ถ้าชี้แค่ ".env" เส้นทางหลังจะหา SYS_USER ไม่เจอ → Settings() พังตอน import
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        # root .env มี key ของ client/backend ปนอยู่ (JWT_*, SMTP_*, DATABASE_URL)
        # ต้อง ignore ไม่งั้น pydantic-settings raise extra_forbidden ตอน import
        extra="ignore",
    )


settings = Settings()
