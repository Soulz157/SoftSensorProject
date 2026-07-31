import traceback
from services.tag_service import TagService
from fastapi import APIRouter, Query, Depends, HTTPException, Response
from schemas import TagListResponse, TagItem
from schemas.data import TagCurrentRequest, TagCurrentResponse
from dependencies import get_tag_service
from intergrations import PIWebAPI

router = APIRouter(prefix="/v1/tags", tags=["Tags"])


@router.get(
    "",
    # response_model=TagListResponse,
    summary="ดึงรายชื่อ PI Tag ทั้งหมด (หรือค้นหา)",
)
async def list_tags(
    q: str = Query("*", description="Wildcard filter เช่น D1-* หรือ *MEAS*"),
    max_count: int = 40,
    service: TagService = Depends(get_tag_service),
):
    try:
        return service.list_tags(name_filter=q, max_count=max_count)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {e}")


@router.post(
    "/current",
    response_model=TagCurrentResponse,
    summary="Retrieve current (snapshot) values + quality for selected tags",
)
async def tags_current(
    body: TagCurrentRequest,
    service: TagService = Depends(get_tag_service),
) -> TagCurrentResponse:
    try:
        return service.current_values(body.tag_list, batch_size=body.batch_size)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {e}")
