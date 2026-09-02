"""MODEL-SERVE-002. Serving runtime entrypoint — a long-running process
that loads PRODUCTION ModelVersions from object storage and answers
bounded synchronous prediction requests. One image, many models.

sys.path[0] is this file's directory (/app in the built image, matching
images/trainer's own convention), which is what makes the flat absolute
imports (`from config import settings`, `from services.loader import ...`)
resolve identically here and under pytest (see tests/conftest.py).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from routers.serve import router as serve_router
from services.descriptor import DescriptorClient

logger = logging.getLogger("serving")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.descriptor_client = DescriptorClient()

    from services.loader import ModelLoader

    app.state.loader = ModelLoader()
    app.state.ready = False

    # T03. Warm the production set BEFORE reporting ready — getting this
    # backwards means traffic arrives during cold load and the first
    # caller pays for everyone. A model that fails to warm is logged, not
    # fatal: /readyz still flips true once the warm PASS completes, so one
    # broken model does not block every other model from serving.
    try:
        versions = app.state.descriptor_client.list_production_versions()
        for entry in versions:
            model_id = entry.get("modelId")
            if not model_id:
                continue
            try:
                descriptor = app.state.descriptor_client.get_descriptor(
                    model_id)
                app.state.loader.get(model_id, descriptor)
            except Exception:
                logger.exception("Failed to warm model %s", model_id)
    except Exception:
        logger.exception("Failed to list production versions at startup")

    app.state.ready = True
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="SoftSensor Serving", lifespan=lifespan)
    app.include_router(serve_router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        """T03. Answers without touching MinIO or Postgres — a liveness
        probe that depends on them turns a dependency blip into a restart
        loop. This process holds neither credential anyway."""
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> JSONResponse:
        """T03. Answers ready only after the production set has been
        loaded (or attempted) once."""
        if not getattr(app.state, "ready", False):
            return JSONResponse(status_code=503, content={"status": "warming"})
        return JSONResponse(status_code=200, content={"status": "ready"})

    return app


app = create_app()
