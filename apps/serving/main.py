"""MODEL-SERVE-002. Serving runtime entrypoint — a long-running process
that loads PRODUCTION ModelVersions from object storage and answers
bounded synchronous prediction requests. One image, many models.

sys.path[0] is this file's directory (/app in the built image, matching
images/trainer's own convention), which is what makes the flat absolute
imports (`from config import settings`, `from services.loader import ...`)
resolve identically here and under pytest (see tests/conftest.py).
"""

from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from config import settings
from routers.serve import router as serve_router
from services.descriptor import DescriptorClient
from services.warmup import warm_production_set

logger = logging.getLogger("serving")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.descriptor_client = DescriptorClient()

    from services.loader import ModelLoader

    app.state.loader = ModelLoader()
    app.state.ready = False

    # T03. Warm the production set BEFORE reporting ready — getting this
    # backwards means traffic arrives during cold load and the first
    # caller pays for everyone. The warm runs in a worker thread rather
    # than inline: it now retries while the backend is unreachable
    # (`services/warmup.py`), and blocking startup on that would also take
    # /healthz down with it. /readyz stays 503 until the warm pass ends,
    # successful or not.
    stop = threading.Event()

    def _warm() -> None:
        try:
            warm_production_set(
                app.state.descriptor_client,
                app.state.loader,
                retry_seconds=settings.SERVING_WARM_RETRY_SECONDS,
                stop=stop,
            )
        finally:
            app.state.ready = True

    warm_task = asyncio.create_task(asyncio.to_thread(_warm))
    try:
        yield
    finally:
        # Ends a pending retry wait at once. An HTTP call or model download
        # already in flight is bounded by its own timeout, so shutdown waits
        # only briefly rather than for it.
        stop.set()
        await asyncio.wait({warm_task}, timeout=5)


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
