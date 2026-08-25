# services/data_service.py
"""
Batch time-series fetch จาก PI Web API.

Batch 2 มิติพร้อมกัน:
  - แกน tags : chunk ตาม batch_size (กัน WebID/URL ยาวเกิน limit ของ PI)
  - แกน time : split time window เมื่อจำนวน point ต่อ request เกิน budget

budget ต่อ 1 PI call = max_points_per_request
points_per_tag = (end - start) / interval
budget_per_tag = max_points_per_request / tags_in_batch
ถ้า points_per_tag > budget_per_tag → split แกน time

ตัวอย่าง: 50 tags / interval 1d / range 1 ปี
  → 365 points/tag, budget/tag = 100_000/50 = 2000 → ไม่ split (1 window/chunk)
  แต่ 1m over 1 ปี = 525,600 จุด/tag → split อัตโนมัติ
"""
import asyncio
from curses import window
import math
import re
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import traceback


from intergrations import PIWebAPI
from intergrations.aveva_connect import chunked
from schemas.data import (
    DataFetchRequest,
    DataFetchResponse,
    TagDataPoint,
    TagDataResult,
)

# หน่วย interval: s=วินาที m=นาที(ไม่ใช่เดือน) h=ชั่วโมง d=วัน
_INTERVAL_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1.0, "m": 60.0, "h": 3600.0, "d": 86400.0}

# รูปแบบเวลาที่ส่งกลับเข้า PI — ตรงกับ example ใน DataFetchRequest
_PI_TIME_FMT = "%Y-%m-%d %H:%M:%S.%f"


def parse_interval(value: str) -> timedelta:
    """'1d' | '1h' | '5m' | '30s' -> timedelta ('m' = minutes, ไม่ใช่ month)."""
    match = _INTERVAL_RE.match(value or "")
    if not match:
        raise ValueError(
            f"Invalid interval {value!r}. Use <number><s|m|h|d> "
            f"e.g. '30s', '5m', '1h', '1d' ('m' means minutes, not months)."
        )
    qty, unit = match.groups()
    seconds = float(qty) * _UNIT_SECONDS[unit.lower()]
    if seconds <= 0:
        raise ValueError(f"Interval must be greater than zero, got {value!r}.")
    return timedelta(seconds=seconds)


def parse_timestamp(value: str, field: str) -> datetime:
    """
    รับเฉพาะเวลาแบบ absolute — PI relative string ('*', '*-1y') split แกน time
    ไม่ได้เพราะทำ arithmetic ไม่ได้ จึง reject ตั้งแต่ต้นทาง
    """
    raw = (value or "").strip()
    if not raw:
        raise ValueError(f"{field} is required.")
    if "*" in raw:
        raise ValueError(
            f"{field}={value!r} is a PI relative time. This endpoint requires an "
            f"absolute timestamp such as '2026-06-22 00:00:00.000000'."
        )
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    parsed = pd.to_datetime(raw, errors="coerce")
    if pd.isna(parsed):
        raise ValueError(
            f"{field}={value!r} could not be parsed as an absolute timestamp."
        )
    return parsed.to_pydatetime()


def _fmt_pi_time(moment: datetime) -> str:
    return moment.strftime(_PI_TIME_FMT)


def _native(value):
    """numpy scalar -> python native (pydantic ไม่ต้องเดา type)."""
    return value.item() if hasattr(value, "item") else value


class DataService:
    def __init__(
        self,
        webapi: PIWebAPI,
        max_points_per_request: int = 100_000,
        max_concurrency: int = 4,
    ):
        self.webapi = webapi
        self.max_points_per_request = max(1, max_points_per_request)
        self.max_concurrency = max(1, max_concurrency)

    # ── batching helpers (pure) ──────────────────────────────

    @staticmethod
    def _chunk(tag_list: list[str], batch_size: int) -> list[list[str]]:
        """แกน tags — ใช้ chunked() ที่มีอยู่แล้วใน integration."""
        return list(chunked(list(tag_list), max(1, batch_size)))

    def _time_windows(
        self,
        start: datetime,
        end: datetime,
        interval: timedelta,
        tags_in_batch: int,
    ) -> list[tuple[datetime, datetime]]:
        """
        แกน time — คืน list ของ (start, end).
        window ถูกสร้างแบบ half-open (window ถัดไปเริ่มที่ prev_end + interval)
        จุดที่ขอบจึงไม่ถูกส่งกลับซ้ำโดยโครงสร้าง
        """
        if end <= start:
            raise ValueError("end_time must be after start_time.")

        points_per_tag = math.ceil((end - start) / interval)
        budget_per_tag = max(
            1, self.max_points_per_request // max(1, tags_in_batch))
        if points_per_tag <= budget_per_tag:
            return [(start, end)]

        span = interval * budget_per_tag
        windows: list[tuple[datetime, datetime]] = []
        cursor = start
        while cursor < end:
            window_end = min(cursor + span, end)
            windows.append((cursor, window_end))
            cursor = window_end + interval
        return windows

    @staticmethod
    def _dedupe(points: list[TagDataPoint]) -> list[TagDataPoint]:
        """กันจุด timestamp ซ้ำที่ขอบ window (safety net)."""
        seen: set[str] = set()
        out: list[TagDataPoint] = []
        for point in points:
            if point.timestamp in seen:
                continue
            seen.add(point.timestamp)
            out.append(point)
        return out

    @staticmethod
    def _records(df: Optional[pd.DataFrame], tag: str) -> Optional[list[TagDataPoint]]:
        """
        wide DataFrame (timestamp | tagA | tagB | ...) -> point list ของ tag เดียว.

        คืน None เมื่อ "ไม่มี column ของ tag นี้" ซึ่งต่างจาก [] ที่แปลว่า
        "มี column แต่ไม่มีค่า" — ตัวแรกคือ tag หาย ต้องนับเป็น failed
        """
        if df is None or tag not in df.columns:
            return None
        points: list[TagDataPoint] = []
        for _, row in df.iterrows():
            value = row[tag]
            if pd.isna(value):
                continue
            points.append(
                TagDataPoint(timestamp=str(
                    row["timestamp"]), value=_native(value))
            )
        return points

    # ── PI call ──────────────────────────────────────────────

    def _call_pi(
        self,
        tags: list[str],
        window: tuple[datetime, datetime],
        cal_basis: str,
        summary_type: list[str],
        interval: str,
    ) -> pd.DataFrame:
        """
        sync call — ถูกห่อด้วย asyncio.to_thread เสมอ

        list(tags) เป็น copy โดยตั้งใจ: convertAverageDicttoDataFrame ทำ
        tag_list.insert(0, "timestamp") แบบ in place ถ้าไม่ copy list เดิมจะพัง
        """
        window_start, window_end = window
        return self.webapi.getAverageValue(
            list(tags),
            _fmt_pi_time(window_start),
            _fmt_pi_time(window_end),
            cal_basis,
            list(summary_type),
            interval,
        )

    async def _run_job(
        self,
        sem: asyncio.Semaphore,
        chunk: list[str],
        window: tuple[datetime, datetime],
        cal_basis: str,
        summary_type: list[str],
        interval: str,
    ) -> dict[str, tuple[list[TagDataPoint], Optional[str]]]:
        """
        1 งาน = (tag-chunk x time-window). คืน per-tag (points, error).
        ไม่ raise — ความล้มเหลวถูกแปลงเป็น error ต่อ tag เสมอ
        """
        out: dict[str, tuple[list[TagDataPoint], Optional[str]]] = {}
        df: Optional[pd.DataFrame] = None
        chunk_error: Optional[str] = None

        async with sem:
            try:
                df = await asyncio.to_thread(
                    self._call_pi, chunk, window, cal_basis, summary_type, interval
                )
            except Exception as exc:
                chunk_error = str(exc) or repr(exc)
                # traceback.print_exc()

        # tag ที่ยังไม่ได้ข้อมูล: batch พัง หรือ column หายจาก frame ที่สำเร็จ
        # (converter map column แบบ positional — tag เสียตัวเดียวทำทั้ง chunk เพี้ยนได้)
        pending: list[str] = []
        if chunk_error is None:
            for tag in chunk:
                records = self._records(df, tag)
                if records is None:
                    pending.append(tag)
                else:
                    out[tag] = (records, None)
        else:
            pending = list(chunk)

        # fallback ยิงทีละ tag ก่อนตัดสินว่า failed

        single = None
        for tag in pending:
            async with sem:
                try:
                    single = await asyncio.to_thread(
                        self._call_pi, [
                            tag], window, cal_basis, summary_type, interval
                    )
                    # print(
                    #     f"[DEBUG] single {tag} rows={0 if single is None else len(single)}", flush=True)
                    # if single is not None:
                    # print(single.to_string(), flush=True)
                except Exception as exc:
                    # print(f"[DEBUG] single {tag} FAILED: {exc}", flush=True)
                    out[tag] = ([], str(exc) or repr(exc) or chunk_error)
                    continue
            records = self._records(single, tag)
            if records is None:
                out[tag] = (
                    [], f"Tag {tag!r} was not returned by PI for this window.")
            else:
                out[tag] = (records, None)

        return out

    # ── public ───────────────────────────────────────────────

    async def fetch(self, body: DataFetchRequest, interval: str) -> DataFetchResponse:
        interval_td = parse_interval(interval)
        start = parse_timestamp(body.start_time, "start_time")
        end = parse_timestamp(body.end_time, "end_time")
        if end <= start:
            raise ValueError("end_time must be after start_time.")

        cal_basis = body.cal_basis.value
        # ส่ง summary type เดียว — convertAverageDicttoDataFrame map column แบบ
        # positional จึงรองรับได้แค่ 1 summary ต่อ tag
        summary_type = (
            [body.summary_type[0].value] if body.summary_type else ["Average"]
        )

        sem = asyncio.Semaphore(self.max_concurrency)
        jobs = []

        for chunk in self._chunk(body.tag_list, body.batch_size):
            for window in self._time_windows(start, end, interval_td, len(chunk)):
                jobs.append(
                    self._run_job(sem, chunk, window, cal_basis,
                                  summary_type, interval)
                )

        job_results = await asyncio.gather(*jobs, return_exceptions=True)
        # print(
        #     f"fetch: {len(job_results)} jobs completed for {len(body.tag_list)} tags")
        # print(
        #     f"{job_results}")

        points: dict[str, list[TagDataPoint]] = {t: [] for t in body.tag_list}
        errors: dict[str, list[str]] = {t: [] for t in body.tag_list}
        windows_total: dict[str, int] = {t: 0 for t in body.tag_list}
        windows_ok: dict[str, int] = {t: 0 for t in body.tag_list}
        unexpected: list[str] = []

        for result in job_results:
            if isinstance(result, BaseException):
                # _run_job ไม่ควร raise — กันไว้ไม่ให้ทั้ง request ล้มเงียบ
                unexpected.append(str(result) or repr(result))
                continue
            for tag, (tag_points, tag_error) in result.items():
                if tag not in windows_total:
                    continue
                windows_total[tag] += 1
                if tag_error is None:
                    windows_ok[tag] += 1
                    points[tag].extend(tag_points)
                else:
                    errors[tag].append(tag_error)

        results: list[TagDataResult] = []
        succeeded = 0
        failed = 0
        seen_tags: set[str] = set()

        for tag in body.tag_list:
            if tag in seen_tags:
                continue
            seen_tags.add(tag)

            total = windows_total[tag]
            ok = windows_ok[tag]
            tag_errors = errors[tag] or unexpected

            if total == 0 or ok == 0:
                status = "failed"
            elif ok == total:
                status = "ok"
            else:
                status = "partial"

            if status == "failed":
                failed += 1
            else:
                succeeded += 1

            results.append(
                TagDataResult(
                    tag_name=tag,
                    data=self._dedupe(
                        sorted(points[tag], key=lambda p: p.timestamp)),
                    status=status,
                    error=tag_errors[0] if (
                        status != "ok" and tag_errors) else None,
                )
            )

        return DataFetchResponse(
            start_time=body.start_time,
            end_time=body.end_time,
            total_tags=len(results),
            succeeded_tags=succeeded,
            failed_tags=failed,
            batch_size=body.batch_size,
            results=results,
        )
