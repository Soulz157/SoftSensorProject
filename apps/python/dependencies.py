from functools import lru_cache
import logging
from intergrations import PIWebAPI
from config import settings as constant

logger = logging.getLogger(__name__)

_pi_client: PIWebAPI | None = None

SYS_USER = "CEMENTHAI\\repcohistservice"
SYS_PASS = "P@ssw0rd@1234"

## ==Config PI Server==##
RANGE_TIME = 1
# PI_NAME = "TPERYPIDH01"
PI_NAME = "RYGPDH01"
CAL_TYPR = "Average"
CAL_BASIS = "TimeWeighted"
INTERVAL_TIME = "1m"


# def init_pi_client() -> PIWebAPI:
#     """เรียกใน FastAPI startup event เท่านั้น — สร้าง client ครั้งเดียวต่อ process"""
#     global _pi_client
#     if _pi_client is None:
#         _pi_client = PIWebAPI(
#             api_server="https://scgc-piwebapi.scg.com/piwebapi/",
#             user=constant.SYS_USER,
#             pwd=constant.SYS_PASS,
#             pi_server=constant.PI_NAME,
#         )
#         # ยืนยัน connection ตั้งแต่ startup — ถ้า auth ผิดจะรู้ทันทีตอนแอปเริ่ม ไม่ใช่ตอน user ยิง request
#         info = _pi_client.test_connection()
#         logger.info(f"PI Web API connected: {info}")
#     return _pi_client


@lru_cache(maxsize=1)
def get_pi_client() -> PIWebAPI:
    return PIWebAPI(
        api_server="https://scgc-piwebapi.scg.com/piwebapi/",
        user=SYS_USER,
        pwd=SYS_PASS,
        pi_server=PI_NAME,
    )
