import asyncio
import requests
from requests.auth import HTTPBasicAuth
from fastapi import APIRouter, Depends, HTTPException
from schemas import DataFetchRequest, DataFetchResponse, TagDataResult
from dependencies import get_pi_client
from intergrations import PIWebAPI

router = APIRouter(prefix="/v1/data", tags=["Data"])


@router.post(
    "/fetch",
    response_model=DataFetchResponse,
    summary="ดึงค่า Tag ตาม time range (รองรับ batch)",
)
async def fetch_tag_data(
    body: DataFetchRequest,
    webapi: PIWebAPI = Depends(get_pi_client),
):
    try:
        cal_basis_str = body.cal_basis.value
        summary_types_str = [st.value for st in body.summary_type]

        tag_results_dict = await asyncio.to_thread(
            webapi.fetch_tags_in_batches,
            tag_list=body.tag_list,
            start_time=body.start_time,
            end_time=body.end_time,
            cal_basis=cal_basis_str,
            # summary_type=summary_types_str,
            # summary_duration=body.summary_duration,
            batch_size=body.batch_size
        )

        # จัดเตรียมข้อมูลเพื่อ Response
        results = []
        succeeded_count = 0
        failed_count = 0

        for tag_name, info in tag_results_dict.items():
            status = info["status"]
            if status in ("ok", "partial"):
                succeeded_count += 1
            else:
                failed_count += 1

            results.append(
                TagDataResult(
                    tag_name=tag_name,
                    data=info["data"],
                    status=status,
                    error=info["error"]
                )
            )

        return DataFetchResponse(
            start_time=body.start_time,
            end_time=body.end_time,
            total_tags=len(body.tag_list),
            succeeded_tags=succeeded_count,
            failed_tags=failed_count,
            batch_size=body.batch_size,
            results=results
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
