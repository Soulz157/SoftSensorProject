from fastapi import APIRouter, Query, Depends, HTTPException
from schemas import TagListResponse, TagItem
from dependencies import get_pi_client
from services import PIWebAPI

router = APIRouter(prefix="/tags", tags=["Tags"])


@router.get(
    "",
    response_model=TagListResponse,
    summary="ดึงรายชื่อ PI Tag ทั้งหมด (หรือค้นหา)",
)
async def list_tags(
    q: str = Query(
        "*",    description="Wildcard filter เช่น D1-* หรือ *MEAS*"),
    max_count: int = Query(1000,   ge=1, le=5000),
    webapi: PIWebAPI = Depends(get_pi_client),
):
    try:
        raw = webapi.search_tags(query=q, max_count=max_count)
        items = [TagItem(**t) for t in raw]
        return TagListResponse(total=len(items), tags=items)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PI Web API error: {e}")
