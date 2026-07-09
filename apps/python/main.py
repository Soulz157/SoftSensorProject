import urllib3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routers import data, tags


def create_app() -> FastAPI:

    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
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

    return app


app = create_app()


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}
