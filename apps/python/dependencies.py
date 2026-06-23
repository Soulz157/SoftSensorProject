from functools import lru_cache
from services import PIWebAPI
from config import settings as constant


@lru_cache(maxsize=1)
def get_pi_client() -> PIWebAPI:
    return PIWebAPI(
        api_server="https://tpe-piwebapi.scg.com/piwebapi/",
        user=constant.SYS_USER,
        pwd=constant.SYS_PASS,
        pi_server=constant.PI_NAME,
    )
