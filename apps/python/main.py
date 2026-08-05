import urllib3
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from intergrations.pi_http import install_pi_timeouts
from routers import data, tags, data_source, preprocess, presets


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
        "name": "Preprocess",
        "description": (
            "Data cleaning over stored dataset artifacts — preview before "
            "apply. Preview never writes."
        ),
    },
    {
        "name": "Presets",
        "description": (
            "Soft-sensor feature presets — import an engineering workbook and "
            "store one JSON document per unit/config."
        ),
    },
    {
        "name": "Health",
        "description": "Service status สำหรับ liveness/readiness probe",
    },
]


async def redacted_validation_handler(
    _request: Request, exc: Exception
) -> JSONResponse:
    """422 bodies WITHOUT the offending input echoed back.

    FastAPI's default handler returns `exc.errors()` verbatim, and every
    pydantic v2 error carries an `input` key holding the value that failed.
    Every credential-bearing endpoint in this service — `/v1/data-sources/*`
    and `/v1/preprocess/materialize` — takes a body containing a DECRYPTED
    password, so one malformed request round-trips that password back to the
    caller. Verified before this handler existed: a `/materialize` call missing
    `tag_list` answered 422 with `"password":"<plaintext>"` in the body, and
    `python-client.ts` relays an upstream 4xx `detail` onward as the message of
    an AppException.

    `loc`, `type` and `msg` are kept — they say WHICH field is wrong and why,
    which is everything a caller needs to fix the request. `input` and `ctx`
    are dropped because both can carry submitted values.
    """
    errors = exc.errors() if isinstance(exc, RequestValidationError) else []
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {
                    "type": error.get("type"),
                    "loc": list(error.get("loc", ())),
                    "msg": error.get("msg"),
                }
                for error in errors
            ]
        },
    )


def create_app() -> FastAPI:

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    # The PI SDK issues every request without a timeout; unbounded, one silent
    # PI host parks a worker forever. Must run before any request is served.
    install_pi_timeouts()

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
    app.include_router(preprocess)
    app.include_router(presets)

    app.add_exception_handler(RequestValidationError, redacted_validation_handler)

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
