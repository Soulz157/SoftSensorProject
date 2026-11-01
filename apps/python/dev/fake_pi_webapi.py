"""
Dev-only fake PI Web API for document mockups.

Serves the slice of the PI Web API that `intergrations/aveva_connect.py`
calls through the osisoft SDK, with a generated tag catalog and generated
INTEGER readings. Add it in the app as an AVEVA data source and the real
Create Dataset flow runs end to end, unmodified, on mock tags:

    apps/python/.venv/bin/python apps/python/dev/fake_pi_webapi.py

    Data source host : http://127.0.0.1:8765/piwebapi
    PI server        : any name (echoed back), e.g. PI-DEMO
    Username/password: anything (not checked)

Readings are a pure function of (tag, timestamp), so every fetch of the same
range returns the same numbers. The lab tags follow a fixed blend of a few
inputs, so the correlation heatmap and training have something to find.
A naive time from the connector is read as Asia/Bangkok, like the real PI
server; every timestamp goes back in UTC.
"""
from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

BANGKOK = timezone(timedelta(hours=7))

# name, descriptor, unit, base, amplitude, noise, driver weights (d1, d2, d3)
_SPECS: list[tuple[str, str, str, int, int, int, tuple[float, float, float]]] = []


def _add(label, count, desc, unit, base, amp, noise, weights):
    for i in range(count):
        name = f"{label}-{i + 1}"
        w = tuple(x * (1 + 0.15 * ((i % 3) - 1)) for x in weights)
        _SPECS.append((name, f"{desc} {i + 1}", unit, base + 10 * i, amp, noise, w))


_add("Flow", 13, "Feed Flow", "m3/h", 420, 60, 4, (0.6, 0.3, 0.5))
_add("Temperature", 8, "Reactor Temperature", "degC", 280, 25, 2, (0.4, 0.5, 0.4))
_add("Pressure", 4, "Column Pressure", "kPa", 650, 80, 6, (0.5, 0.2, 0.6))
_add("Level", 3, "Drum Level", "%", 55, 15, 2, (0.3, 0.6, 0.3))
_add("Analyzer", 5, "Analyzer", "ppm", 120, 30, 3, (0.7, 0.2, 0.4))
_add("Speed", 2, "Pump Speed", "rpm", 2950, 120, 10, (0.5, 0.4, 0.2))
# Mock names the document mockup map uses that the families above lack.
_add("Flow Calc", 1, "Calculated Flow", "m3/h", 380, 50, 3, (0.6, 0.3, 0.4))
_add("Signal", 1, "Control Signal", "%", 50, 20, 2, (0.4, 0.4, 0.4))
_add("Feed Index", 2, "Feed Index", "-", 850, 30, 2, (0.3, 0.5, 0.4))
_add("Ratio", 1, "Reflux Ratio", "-", 3, 1, 0, (0.5, 0.3, 0.4))
for loop in ("Flow-1", "Flow-2", "Temperature-1", "Pressure-1"):
    base = next(s for s in _SPECS if s[0] == loop)
    _SPECS.append((f"{loop}.SP", base[1] + " Setpoint", base[2], base[3], 0, 0, (0, 0, 0)))
    _SPECS.append((f"{loop}.OP", base[1] + " Output", "%", 60, 20, 2, base[6]))

LAB_TAGS = {
    # lab tag -> (descriptor, unit, base, [(input tag, weight)])
    "Lab Quality-1": ("Product Quality Index 1", "%", 0, [
        ("Flow-1", 0.08), ("Temperature-2", 0.12), ("Pressure-1", -0.03),
        ("Analyzer-1", 0.15)]),
    "Lab Quality-2": ("Product Quality Index 2", "ppm", 40, [
        ("Temperature-4", 0.2), ("Level-1", 0.4), ("Flow-3", -0.05)]),
}
LAB_HOLD = timedelta(hours=4)

TAGS: dict[str, dict] = {}
for name, desc, unit, base, amp, noise, w in _SPECS:
    TAGS[name] = {"desc": desc, "unit": unit, "base": base, "amp": amp,
                  "noise": noise, "w": w, "type": "Int32"}
for name, (desc, unit, _b, _mix) in LAB_TAGS.items():
    TAGS[name] = {"desc": desc, "unit": unit, "type": "Int32"}
TAG_NAMES = sorted(TAGS)

# Real plant tag -> mock tag, mirroring the tag tokens of
# apps/client/components/dev/mockup-map.ts. A feature preset saved from the
# real plant still asks PI for its REAL names; with mockup mode on, the page
# shows them as the mock names, so each alias serves the SAME series as its
# mock tag. Aliases resolve by name only — catalog search lists mock names.
ALIASES: dict[str, str] = {
    "AI602A.PV": "Analyzer-4", "AI602B.PV": "Analyzer-5",
    "FIC318.PV": "Flow-10", "FIC505.PV": "Flow-11", "FIC604.PV": "Flow-12",
    "FIC608.PV": "Flow-13", "LI602.PV": "Level-1", "M620CTS1.PV": "Signal-1",
    "AI001A2.PV": "Analyzer-1", "AI001B2.PV": "Analyzer-2", "AI206.PV": "Analyzer-3",
    "FI001.PV": "Flow-1", "FI003.PV": "Flow-2", "FIC107R.PV": "Flow-3",
    "FIC114A.PV": "Flow-4", "FIC114B.PV": "Flow-5", "FIC114C.PV": "Flow-6",
    "FIC114D.PV": "Flow-7", "FIC114I.PV": "Flow-8", "FIC204.PV": "Flow-9",
    "FY107.CPV": "Flow Calc-1", "TI202.PV": "Temperature-1",
    "TI203.PV": "Temperature-2", "TI205.PV": "Temperature-3",
    "TI206.PV": "Temperature-4", "TI207.PV": "Temperature-5",
    "S204IBP.lab": "Lab Quality-1", "s611water.lab": "Lab Quality-2",
    "Spgr_in_feed_Header_1": "Feed Index-1", "Spgr_in_feed_Header_2": "Feed Index-2",
    "Reflux_ratio_per_total_feed_of_Quench_oil_tower": "Ratio-1",
}
assert all(target in TAGS for target in ALIASES.values())


def _canon(tag: str) -> str:
    return ALIASES.get(tag, tag)


def _known(tag: str) -> bool:
    return tag in TAGS or tag in ALIASES


def _hash01(*parts) -> float:
    """Deterministic value in [-1, 1)."""
    h = hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8)
    return int.from_bytes(h.digest(), "big") / 2**63 - 1


def _drivers(t: float) -> tuple[float, float, float]:
    """Shared plant state: daily cycle, weekly cycle, slow wander."""
    day, week = 86400.0, 7 * 86400.0
    d1 = math.sin(2 * math.pi * t / day)
    d2 = math.sin(2 * math.pi * t / week + 1.3)
    d3 = (math.sin(2 * math.pi * t / (3.1 * day)) * 0.6
          + math.sin(2 * math.pi * t / (11.7 * day) + 0.4) * 0.4)
    return d1, d2, d3


# Bad data so Data Cleaning has a clear before/after. Each event lasts one
# whole hour, so it survives a 1h Average at full size. Rates are per hour.
SPIKE_RATE = 0.08      # ~58 spikes/month per tag, up or down, 3-6x amplitude
DROPOUT_RATE = 0.02    # reads 0 (transmitter dropout), ~14/month per tag
LAB_BAD_RATE = 0.10    # lab results off by 30-60% (wrong sample / typo)
CLEAN_TAGS = (".SP", ".OP")  # setpoints/outputs stay clean


def _bad_event(tag: str, spec: dict, hour: int, v: float) -> float:
    if tag.endswith(CLEAN_TAGS) or spec["amp"] == 0:
        return v
    if _hash01(tag, "drop", hour) > 1 - 2 * DROPOUT_RATE:
        return 0
    if _hash01(tag, "spike", hour) > 1 - 2 * SPIKE_RATE:
        size = 3 + 3 * (_hash01(tag, "size", hour) + 1) / 2
        sign = 1 if _hash01(tag, "sign", hour) > -0.3 else -1
        return v + sign * size * spec["amp"]
    if tag == "Analyzer-2" and (hour // 12) % 23 == 5:
        return spec["base"]  # analyzer stuck for half a day
    return v


def _raw(tag: str, t: float, clean: bool = False) -> float:
    if tag in LAB_TAGS:
        _d, _u, base, mix = LAB_TAGS[tag]
        held = t - (t % LAB_HOLD.total_seconds())
        # Lab follows the TRUE process, not the instrument glitches.
        v = base + sum(_raw(src, held, clean=True) * w for src, w in mix)
        v += 1.5 * _hash01(tag, int(held))
        if not clean and _hash01(tag, "labbad", int(held)) > 1 - 2 * LAB_BAD_RATE:
            off = 0.3 + 0.3 * (_hash01(tag, "labsize", int(held)) + 1) / 2
            v *= 1 + off if _hash01(tag, "labsign", int(held)) > 0 else 1 - off
        return v
    spec = TAGS[tag]
    d1, d2, d3 = _drivers(t)
    w1, w2, w3 = spec["w"]
    v = spec["base"] + spec["amp"] * (w1 * d1 + w2 * d2 + w3 * d3)
    minute = int(t // 60)
    v += spec["noise"] * _hash01(tag, minute)
    return v if clean else _bad_event(tag, spec, minute // 60, v)


def value_at(tag: str, moment: datetime) -> int:
    return int(round(_raw(_canon(tag), moment.timestamp())))


# ── PI JSON shapes ───────────────────────────────────────────

def _web_id(tag: str) -> str:
    return "FAKEPT" + base64.urlsafe_b64encode(tag.encode()).decode().rstrip("=")


def _tag_from_web_id(web_id: str) -> str | None:
    if not web_id.startswith("FAKEPT"):
        return None
    raw = web_id[6:]
    try:
        name = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
    except Exception:
        return None
    return name if _known(name) else None


def _point(tag: str, server: str) -> dict:
    spec = TAGS[_canon(tag)]
    return {
        "WebId": _web_id(tag), "Id": TAG_NAMES.index(_canon(tag)) + 1, "Name": tag,
        "Path": f"\\\\{server}\\{tag}", "Descriptor": spec["desc"],
        "PointClass": "classic", "PointType": spec["type"],
        "DigitalSetName": "", "EngineeringUnits": spec["unit"],
        "Step": _canon(tag) in LAB_TAGS, "Future": False,
    }


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _timed(tag: str, moment: datetime, value=None) -> dict:
    return {
        "Timestamp": _iso(moment),
        "Value": value_at(tag, moment) if value is None else value,
        "UnitsAbbreviation": TAGS[_canon(tag)]["unit"], "Good": True,
        "Questionable": False, "Substituted": False, "Annotated": False,
    }


def _interval(raw: str | None) -> timedelta:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([smhd])\s*", raw or "1h")
    if not m:
        return timedelta(hours=1)
    qty, unit = m.groups()
    sec = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit] * float(qty)
    return timedelta(seconds=max(1.0, sec))


def _parse_time(raw: str | None, default: datetime) -> datetime:
    if not raw:
        return default
    s = raw.strip()
    now = datetime.now(timezone.utc)
    if s.startswith("*"):
        m = re.fullmatch(r"\*\s*([+-])\s*(\d+(?:\.\d+)?\s*[smhd])", s)
        if not m:
            return now
        sign, span = m.groups()
        return now - _interval(span) if sign == "-" else now + _interval(span)
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=BANGKOK)


def _grid(start: datetime, end: datetime, step: timedelta):
    t = start
    while t < end:
        yield t
        t += step


def _summary(tag: str, kind: str, a: datetime, step: timedelta) -> int:
    if kind in ("Average", "Total", "Median", "Range", "StdDev", "PopulationStdDev"):
        samples = [value_at(tag, a + step * f) for f in (0.0, 0.25, 0.5, 0.75)]
        if kind == "Range":
            return max(samples) - min(samples)
        if kind in ("StdDev", "PopulationStdDev"):
            avg = sum(samples) / len(samples)
            return int(round(math.sqrt(sum((x - avg) ** 2 for x in samples) / len(samples))))
        avg = int(round(sum(samples) / len(samples)))
        return avg * max(1, int(step.total_seconds() // 86400)) if kind == "Total" else avg
    if kind == "Minimum":
        return min(value_at(tag, a + step * f) for f in (0.0, 0.5, 0.99))
    if kind == "Maximum":
        return max(value_at(tag, a + step * f) for f in (0.0, 0.5, 0.99))
    if kind == "Count":
        return int(step.total_seconds())
    return value_at(tag, a + step / 2)


# ── HTTP ─────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "FakePIWebAPI/1.0"

    def log_message(self, fmt, *args):
        url = urlparse(unquote(self.path))
        query = "&".join(p for p in url.query.split("&") if not p.lower().startswith("webid="))
        print(f"[fake-pi] {self.command} {url.path}?{query[:300]}", flush=True)

    def _send(self, status: int, body) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _not_found(self, msg: str) -> None:
        self._send(404, {"Errors": [msg]})

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        path = re.sub(r"/+", "/", url.path).rstrip("/")
        path = re.sub(r"^/piwebapi", "", path, flags=re.I) or "/"
        q = {k.lower(): v for k, v in parse_qs(url.query, keep_blank_values=True).items()}

        def one(key, default=None):
            return (q.get(key.lower()) or [default])[0]

        def many(key) -> list[str]:
            out: list[str] = []
            for v in q.get(key.lower(), []):
                out.extend(x for x in v.split(",") if x)
            return out

        server = self.server.pi_name  # type: ignore[attr-defined]
        lower = path.lower()
        now = datetime.now(timezone.utc)
        try:
            if lower == "/":
                return self._send(200, {"Links": {"Self": "/piwebapi"}})

            if lower == "/dataservers":
                name = one("name") or (one("path") or "").lstrip("\\") or server
                return self._send(200, {
                    "WebId": "FAKEDS" + name, "Id": "00000000-0000-0000-0000-000000000001",
                    "Name": name, "Path": f"\\\\{name}", "IsConnected": True,
                    "ServerVersion": "3.4.445.688"})

            m = re.fullmatch(r"/dataservers/([^/]+)/points", path, re.I)
            if m:
                pi = m.group(1)[6:] or server
                pattern = (one("nameFilter") or "*").lower()
                hits = [t for t in TAG_NAMES if fnmatch.fnmatchcase(t.lower(), pattern)]
                start = int(one("startIndex") or 0)
                count = int(one("maxCount") or 1000)
                return self._send(200, {"Items": [_point(t, pi) for t in hits[start:start + count]]})

            if lower == "/points":
                tag = (one("path") or "").split("\\")[-1]
                if not _known(tag):
                    return self._not_found(f"PI Point not found '{tag}'.")
                return self._send(200, _point(tag, server))

            if lower == "/points/multiple":
                items = []
                for p in many("path"):
                    tag = p.split("\\")[-1]
                    found = _known(tag)
                    items.append({
                        "Identifier": p, "IdentifierType": "Path",
                        "Object": _point(tag, server) if found else None,
                        "Exception": None if found else {"Errors": [f"PI Point not found '{tag}'."]},
                    })
                return self._send(200, {"Items": items})

            if lower == "/streamsets/value":
                at = now.replace(second=0, microsecond=0)
                items = [
                    {"WebId": w, "Name": tag, "Path": f"\\\\{server}\\{tag}", "Value": _timed(tag, at)}
                    for w in many("webId") if (tag := _tag_from_web_id(w))
                ]
                return self._send(200, {"Items": items})

            if lower in ("/streamsets/summary", "/streamsets/interpolated"):
                start = _parse_time(one("startTime"), now - timedelta(days=1))
                end = _parse_time(one("endTime"), now)
                items = []
                for w in many("webId"):
                    tag = _tag_from_web_id(w)
                    if not tag:
                        continue
                    if lower.endswith("summary"):
                        step = _interval(one("summaryDuration"))
                        kinds = many("summaryType") or ["Total"]
                        values = [
                            {"Type": k, "Value": _timed(tag, a, _summary(tag, k, a, step))}
                            for a in _grid(start, end, step) for k in kinds
                        ]
                    else:
                        step = _interval(one("interval"))
                        values = [_timed(tag, a) for a in _grid(start, end + step, step)]
                    items.append({"WebId": w, "Name": tag, "Path": f"\\\\{server}\\{tag}", "Items": values})
                return self._send(200, {"Items": items})

            m = re.fullmatch(r"/streams/([^/]+)/(recorded|value|interpolated)", path, re.I)
            if m:
                tag = _tag_from_web_id(m.group(1))
                if not tag:
                    return self._not_found("Unknown WebId.")
                kind = m.group(2).lower()
                if kind == "value":
                    return self._send(200, _timed(tag, now))
                start = _parse_time(one("startTime"), now - timedelta(days=1))
                end = _parse_time(one("endTime"), now)
                if kind == "recorded" and _canon(tag) in LAB_TAGS:
                    step = LAB_HOLD
                    sec = step.total_seconds()
                    start = datetime.fromtimestamp(math.ceil(start.timestamp() / sec) * sec, timezone.utc)
                else:
                    step = _interval(one("interval") or "1m")
                cap = int(one("maxCount") or 150000)
                values = []
                for a in _grid(start, end, step):
                    if len(values) >= cap:
                        break
                    values.append(_timed(tag, a))
                return self._send(200, {"Items": values})

            return self._not_found(f"Fake PI Web API does not serve {path}.")
        except Exception as exc:  # noqa: BLE001 — surface as a PI-style error
            return self._send(400, {"Errors": [f"{type(exc).__name__}: {exc}"]})


def main() -> None:
    ap = argparse.ArgumentParser(description="Dev-only fake PI Web API.")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--pi-name", default="PI-DEMO",
                    help="data server name reported when none is asked for")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.pi_name = args.pi_name  # type: ignore[attr-defined]
    print(f"Fake PI Web API on http://{args.host}:{args.port}/piwebapi "
          f"({len(TAGS)} tags, server '{args.pi_name}')", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
