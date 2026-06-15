from fastapi import APIRouter
from schemas import RootResponse

router = APIRouter(tags=["Root"])


@router.get("/", response_model=RootResponse)
def root() -> RootResponse:
    return RootResponse(message="FastAPI is running inside Turborepo 🚀")
