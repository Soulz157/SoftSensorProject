import traceback
from fastapi import APIRouter, Query, Depends, HTTPException
from schemas import TagListResponse, TagItem
from dependencies import get_pi_client
from intergrations import PIWebAPI

router = APIRouter(prefix="/v1/tags", tags=["Tags"])


@router.get(
    "/",
    # response_model=TagListResponse,
    summary="ดึงรายชื่อ PI Tag ทั้งหมด (หรือค้นหา)",
)
async def list_tags(
    # q: str = Query(
    #     "*",    description="Wildcard filter เช่น D1-* หรือ *MEAS*"),
    # max_count: int = Query(1000,   ge=1, le=5000),
    webapi: PIWebAPI = Depends(get_pi_client),
):
    try:
        print("Fetching tags from PI Web API...")
        raw = webapi.search_tags(max_count=10, batch_size=100)
        # items = [TagItem(**t) for t in raw]
        # return TagListResponse(total=len(items), tags=items)
        return raw
    except Exception as e:
        print("====== ERROR DETAILS ======")
        traceback.print_exc()
        print("===========================")
        raise HTTPException(status_code=502, detail=f"PI Web API error: {e}")
