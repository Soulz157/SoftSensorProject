from fastapi import APIRouter, Depends, HTTPException
from schemas import DataFetchRequest, DataFetchResponse, TagDataResult
from dependencies import get_pi_client
from services import PIWebAPI

router = APIRouter(prefix="/data", tags=["Data"])


@router.post(
    "",
    response_model=DataFetchResponse,
    summary="ดึงค่า Tag ตาม time range (รองรับ batch)",
)
async def fetch_tag_data(
    body: DataFetchRequest,
    webapi: PIWebAPI = Depends(get_pi_client),
):
    try:
        raw_results = webapi.fetch_in_batches(
            tag_list=body.tag_list,
            start_time=body.start_time,
            end_time=body.end_time,
            cal_basis=body.cal_basis.value,
            summary_type=[s.value for s in body.summary_type],
            summary_duration=body.summary_duration,
            batch_size=body.batch_size,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PI fetch failed: {e}")

    results = [
        TagDataResult(
            tag_name=tag,
            data=v["data"],
            status=v["status"],
            error=v["error"],
        )
        for tag, v in raw_results.items()
    ]

    succeeded = sum(1 for r in results if r.status != "failed")
    failed = sum(1 for r in results if r.status == "failed")

    return DataFetchResponse(
        start_time=body.start_time,
        end_time=body.end_time,
        total_tags=len(body.tag_list),
        succeeded_tags=succeeded,
        failed_tags=failed,
        batch_size=body.batch_size,
        results=results,
    )
