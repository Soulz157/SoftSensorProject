import time
import pandas as pd
from typing import Optional, Generator
from osisoft.pidevclub.piwebapi.pi_web_api_client import PIWebApiClient
from osisoft.pidevclub.piwebapi.models import PIStreamValue, PITimedValue


def chunked(lst: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(lst), size):
        yield lst[i: i + size]


# ─── PI Client ────────────────────────────────────────────
class PIWebAPI:
    def __init__(self, api_server: str, user: str, pwd: str, pi_server: str):
        self.client = PIWebApiClient(api_server, False, user, pwd, False, True)
        self.pi_server = pi_server

    # ── Internal helpers ───────────────────────────────────
    def _to_web_ids(self, tag_list: list) -> list:
        paths = [f"pi:\\\\{self.pi_server}\\{tag}" for tag in tag_list]
        return self.client.data.convert_paths_to_web_ids(paths)

    def _avg_dict_to_df(self, data, tag_list: list) -> pd.DataFrame:
        cols = ["timestamp"] + tag_list
        rows = []
        n_rows = len(data.items[0].items)
        for i in range(n_rows):
            row = [data.items[0].items[i].value.timestamp]
            for j, _ in enumerate(tag_list):
                row.append(data.items[j].items[i].value.value)
            rows.append(row)
        df = pd.DataFrame(rows, columns=cols)
        df["timestamp"] = (
            pd.to_datetime(df["timestamp"], format="%Y-%m-%dT%H:%M:%S.%fZ")
            + pd.to_timedelta("07:00:00")
        )
        return df

    def _interp_dict_to_df(self, data, tag_list: list) -> pd.DataFrame:
        cols = ["timestamp"] + tag_list
        rows = []
        n_rows = len(data.items[0].items)
        for i in range(n_rows):
            row = [data.items[0].items[i].timestamp]
            for j, _ in enumerate(tag_list):
                row.append(data.items[j].items[i].value)
            rows.append(row)
        df = pd.DataFrame(rows, columns=cols)
        df["timestamp"] = (
            pd.to_datetime(df["timestamp"], format="%Y-%m-%dT%H:%M:%S.%fZ")
            + pd.to_timedelta("07:00:00")
        )
        return df

    # ── Public: get average (single batch) ────────────────
    def get_average_value(
        self,
        tag_list: list,
        start_time: str,
        end_time: str,
        cal_basis: str,
        summary_type: list,
        summary_duration: Optional[str] = None,
    ) -> pd.DataFrame:
        web_ids = self._to_web_ids(tag_list)
        raw = self.client.streamSet.get_summaries_ad_hoc(
            web_id=web_ids,
            start_time=start_time,
            end_time=end_time,
            calculation_basis=cal_basis,
            summary_type=summary_type,
            summary_duration=summary_duration,
        )
        return self._avg_dict_to_df(raw, tag_list)

    # ── Public: Search tags from PI Point ─────────────────
    def search_tags(self, query: str = "*", max_count: int = 1000) -> list[dict]:
        """
        ค้นหา PI Tags โดยใช้ nameFilter
        คืน list ของ dict {tag_name, description, unit}
        """
        results = self.client.point.get_points_query(
            web_id=f"pi:{self.pi_server}",
            query=f"name:{query}",
            max_count=max_count,
            selected_fields="items.name;items.descriptor;items.engineeringUnits"
        )
        tags = []
        for item in results.items:
            tags.append({
                "tag_name": item.name,
                "description": item.descriptor,
                "unit": item.engineering_units,
                "plant": None,
            })
        return tags

    def fetch_in_batches(
        self,
        tag_list: list,
        start_time: str,
        end_time: str,
        cal_basis: str,
        summary_type: list,
        summary_duration: Optional[str],
        batch_size: int = 300,
        max_retry: int = 3,
        retry_delay: float = 2.0,
    ) -> dict[str, dict]:
        """
        Returns
        -------
        {
          "TAG_NAME": {"data": [...], "status": "ok"|"partial"|"failed", "error": str|None},
          ...
        }
        """
        tag_results: dict[str, dict] = {
            tag: {"data": [], "status": "failed", "error": None}
            for tag in tag_list
        }

        for chunk in chunked(tag_list, batch_size):
            df_chunk = None

            # ── Batch attempt ──────────────────────────────
            for attempt in range(1, max_retry + 1):
                try:
                    df_chunk = self.get_average_value(
                        chunk.copy(), start_time, end_time,
                        cal_basis, summary_type, summary_duration
                    )
                    break
                except Exception as e:
                    if attempt == max_retry:
                        break
                    time.sleep(retry_delay)

            # ── Tag-by-tag fallback ────────────────────────
            if df_chunk is None:
                for tag in chunk:
                    for attempt in range(1, max_retry + 1):
                        try:
                            df_tag = self.get_average_value(
                                [tag], start_time, end_time,
                                cal_basis, summary_type, summary_duration
                            )
                            tag_results[tag] = {
                                "data": _df_to_records(df_tag, tag),
                                "status": "partial",
                                "error": None,
                            }
                            break
                        except Exception as e:
                            if attempt == max_retry:
                                tag_results[tag]["error"] = str(e)
                            time.sleep(retry_delay)
            else:
                # ── Parse batch result ─────────────────────
                for tag in chunk:
                    if tag in df_chunk.columns:
                        tag_results[tag] = {
                            "data": _df_to_records(df_chunk, tag),
                            "status": "ok",
                            "error": None,
                        }

        return tag_results


def _df_to_records(df: pd.DataFrame, tag: str) -> list[dict]:
    if tag not in df.columns:
        return []
    return [
        {"timestamp": str(row["timestamp"]), "value": row[tag]}
        for _, row in df.iterrows()
        if pd.notna(row.get(tag))
    ]
