"""MODEL-SERVE-002-T04. POST /v1/models/{model_id}/predict."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

from config import settings
from services import prediction_log
from services.descriptor import DescriptorError
from services.loader import LoadError
from services.predict import (
    PredictError,
    assert_history_satisfies_target_derivation,
    rows_to_predictions,
)

router = APIRouter(prefix="/v1/models", tags=["predict"])


class PredictRequest(BaseModel):
    model_config = {"extra": "forbid"}
    rows: list[dict[str, Any]] = Field(..., min_length=1)


class PredictResponse(BaseModel):
    predictions: list[float]
    modelId: str
    version: int


@router.post("/{model_id}/predict", response_model=PredictResponse)
async def predict(
    model_id: str,
    body: PredictRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> PredictResponse:
    if len(body.rows) > settings.SERVING_MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Request carries {len(body.rows)} rows, over the "
                f"{settings.SERVING_MAX_ROWS}-row cap."
            ),
        )

    descriptor_client = request.app.state.descriptor_client
    loader = request.app.state.loader

    try:
        descriptor = descriptor_client.get_descriptor(model_id)
    except DescriptorError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        model = loader.get(model_id, descriptor)
    except LoadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        assert_history_satisfies_target_derivation(descriptor, body.rows)
        predictions, scaled = rows_to_predictions(model, descriptor, body.rows)
    except PredictError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # MODEL-SERVE-005-T01. Scheduled AFTER the response would be built, via
    # BackgroundTasks — FastAPI runs this once the response has been sent,
    # in a threadpool for a sync function like `log_prediction`, so a slow
    # or unreachable backend never adds latency to /predict itself. The
    # sampling decision happens here, not inside log_prediction, so a
    # sampled-out request costs nothing beyond one `random()` call — no
    # aggregate computation, no background task scheduled at all.
    if prediction_log.should_log():
        background_tasks.add_task(
            prediction_log.log_prediction,
            descriptor_client.session,
            model_id=model_id,
            model_version_id=descriptor["versionId"],
            feature_columns=descriptor["featureColumns"],
            rows=body.rows,
            predictions=predictions,
            scaled=scaled,
        )

    return PredictResponse(
        predictions=predictions, modelId=model_id, version=descriptor["version"]
    )
