import traceback

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from dependencies import get_data_service
from schemas import DataFetchRequest, DataFetchResponse
from services.data_service import DataService

router = APIRouter(prefix="/v1/data", tags=["Data"])


@router.post(
    "/fetch",
    response_model=DataFetchResponse,
    summary="ดึงค่า Tag ตาม time range (batch ทั้งแกน tags และแกน time)",
)
async def fetch_tag_data(
    body: DataFetchRequest,
    service: DataService = Depends(get_data_service),
):
    try:
        return await service.fetch(
            body,
            interval=body.summary_duration or settings.INTERVAL_TIME,
        )
    except ValueError as e:
        # interval ผิดรูป / เวลาไม่ใช่ absolute / end <= start
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {e}")
