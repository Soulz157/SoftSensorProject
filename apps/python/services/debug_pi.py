# apps/python/debug_pi.py  —  throwaway diagnostic, delete after use
import os
from osisoft.pidevclub.piwebapi.pi_web_api_client import PIWebApiClient


# ใช้ค่าเดียวกับที่ app โหลด (env var / config) หรือ hardcode ชั่วคราวก็ได้
API_SERVER = "https://scgc-piwebapi.scg.com/piwebapi/"
USER = "CEMENTHAI\\repcohistservice"
PWD = "P@ssw0rd@1234"
PI_SERVER = "RYGPDH01"

# สร้าง client ตรงๆ — อย่าผ่าน PIWebAPI wrapper เพราะ __init__ มัน raise ก่อน probe
client = PIWebApiClient(API_SERVER, False, USER, PWD, False, True)

# 1) connectivity + auth
try:
    print("HOME:", client.home.get())
except Exception as e:
    print("home.get() failed:", getattr(e, "status", None), e)

# 2) ตัวชี้ขาด: PI Web API expose data server ชื่ออะไรจริงๆ
try:
    servers = client.dataServer.list(
        selected_fields="items.name;items.webId;items.isConnected"
    )
    for s in servers.items:
        print(
            f"  name={s.name!r}  connected={s.is_connected}  webId={s.web_id}")
except Exception as e:
    print("dataServer.list() failed:", getattr(e, "status", None), e)

# 3) cross-check ด้วย path
try:
    ds = client.dataServer.get_by_path(r"\\" + PI_SERVER)
    print("by_path OK:", ds.name, ds.web_id)
except Exception as e:
    print("get_by_path failed:", getattr(e, "status", None), e)
