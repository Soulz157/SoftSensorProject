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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )


settings = Settings()
