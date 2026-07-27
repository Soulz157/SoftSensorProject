import urllib3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routers import data, tags, data_source


DESCRIPTION = """
REST API สำหรับ query process tag catalog และ time-series data.

## Endpoints
* **Tags** — ค้นหา / list metadata ของ process tags (sensor, unit, description)
* **Data** — ดึงค่า time-series ตาม tag + ช่วงเวลา
* **Health** — liveness / readiness probe
"""

tags_metadata = [
    {
        "name": "Tags",
        "description": "Process tag catalog — ค้นหาและ list metadata ของ sensor tags",
    },
    {
        "name": "Data",
        "description": "Time-series data — ดึงค่าตาม tag และช่วงเวลาที่ระบุ",
    },
    {
        "name": "Health",
        "description": "Service status สำหรับ liveness/readiness probe",
    },
]


def create_app() -> FastAPI:

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
        description=DESCRIPTION,
        summary="Process tag & time-series data API",
        openapi_tags=tags_metadata,
        contact={
            "name": "REPCO NEX — Data Team",
            "email": "your-team@repco-nex.com",
        },
        license_info={"name": "Proprietary — REPCO NEX"},
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        swagger_ui_parameters={
            "docExpansion": "none",
            "filter": True,
            "displayRequestDuration": True,
            "persistAuthorization": True,
            "tryItOutEnabled": True,
        },
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        allow_methods=settings.CORS_ALLOW_METHODS,
        allow_headers=settings.CORS_ALLOW_HEADERS,
    )

    app.include_router(data)
    app.include_router(tags)
    app.include_router(data_source)

    return app


app = create_app()


@app.get(
    "/health",
    tags=["Health"],
    summary="Health check",
    description="Returns `{'status': 'ok'}`. ใช้สำหรับ liveness/readiness probe.",
)
async def health():
    return {"status": "ok"}


@app.get(
    "/v1/pi/health",
    tags=["Health"],
    summary="PI service health check",
    description="Alias of /health. Matches the client BFF path in lib/pi/server.ts.",
)
async def pi_health():
    return {"status": "ok"}
