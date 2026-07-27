import logging
from functools import lru_cache

from fastapi import Depends

from config import settings
from intergrations import PIWebAPI
from services.data_service import DataService
from services.tag_service import TagService

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_pi_client() -> PIWebAPI:
    """
    PI client ตัวเดียวต่อ process.

    credential มาจาก config.settings (root .env / env ของ process) เท่านั้น —
    ห้าม hardcode ลงไฟล์นี้อีก ไฟล์นี้อยู่ใน version control
    """
    return PIWebAPI(
        api_server=settings.PI_API_SERVER,
        user=settings.SYS_USER,
        pwd=settings.SYS_PASS,
        pi_server=settings.PI_NAME,
    )


def get_tag_service(webapi: PIWebAPI = Depends(get_pi_client)) -> TagService:
    return TagService(webapi)


def get_data_service(webapi: PIWebAPI = Depends(get_pi_client)) -> DataService:
    return DataService(webapi)
