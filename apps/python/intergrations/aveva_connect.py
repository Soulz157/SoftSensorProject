import os
import time
import logging
import urllib3
import pandas as pd
from typing import Optional, Generator
from osisoft.pidevclub.piwebapi.pi_web_api_client import PIWebApiClient
from osisoft.pidevclub.piwebapi.models import PIStreamValue, PITimedValue


urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def chunked(lst: list, size: int) -> Generator[list, None, None]:
    for i in range(0, len(lst), size):
        yield lst[i: i + size]


class PIWebAPI:
    def __init__(
        self,
        api_server: str,
        user: str,
        pwd: str,
        pi_server: str,
    ):
        self.client = PIWebApiClient(
            api_server, False, user, pwd, False, True)
        self.pi_server = pi_server

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

    def write_data(self, data: dict):
        streamValues = list()
        i = 0
        for tag in data.keys():
            # Initialize variable
            streamValue = PIStreamValue()
            PITime_value = PITimedValue()

            PITime_value.timestamp = data[tag]["timestamp"]
            PITime_value.value = data[tag]["value"]

            streamValue.value = PITime_value
            streamValue.web_id = self.client.point.get_by_path(
                "\\\\" + self.pi_server + "\\" + tag
            ).web_id

            streamValues.append(streamValue)

            i = i + 1

        response = self.client.streamSet.update_value_ad_hoc_with_http_info(
            streamValues
        )

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

    # ── Public: Search tags from PI Point ─────────────────
    def search_tags(
        self,
        name_filter: str = "*",
        max_count: int = 10,
        batch_size: int = 100,
    ) -> pd.DataFrame:
        print(
            f"Searching tags with filter: {name_filter} (max_count={max_count})")

        data_server = self.client.dataServer.get_by_name(name=self.pi_server)
        print(
            f"Found Data Server: {data_server.name} (WebID: {data_server.web_id})")

        points = self.client.dataServer.get_points(
            web_id=data_server.web_id,
            name_filter=name_filter,
            max_count=max_count,
            selected_fields=(
                "items.name;"
                "items.descriptor;"
                "items.engineeringUnits;"
                "items.pointType"
            ),
        )

        rows = []
        for item in points.items:
            rows.append({
                "tag_name": item.name,
                "description": item.descriptor,
                "unit": item.engineering_units,
                "point_type": item.point_type,
            })

        df_tags = pd.DataFrame(rows)

        tag_names = df_tags["tag_name"].tolist()

        # ── Step 2 : ดึง Is Good จาก Snapshot (batch) ─────────
        status_map: dict[str, bool] = {}

        for chunk in chunked(tag_names, batch_size):
            try:
                paths = [f"pi:\\\\{self.pi_server}\\{tag}" for tag in chunk]
                webids = self.client.data.convert_paths_to_web_ids(paths)

                snapshot = self.client.streamSet.get_values_ad_hoc(
                    web_id=webids,
                    selected_fields=(
                        "items.name;"
                        "items.value.value;"
                        "items.value.timestamp;"
                        "items.value.good;"
                        "items.value.questionable;"
                        # "items.value.annotated;"
                        "items.value.substituted"
                    ),
                )

                for item in snapshot.items:
                    val = item.value
                    status_map[item.name] = {
                        "value": val.value,
                        "timestamp": val.timestamp,
                        "Is Good": val.good,
                        "Questionable": val.questionable,
                        # "Annotated": val.annotated,
                        "Substituted": getattr(val, "substituted", None),
                    }

            except Exception as e:
                print(f"⚠️  Snapshot batch failed — {e}")
                for tag in chunk:
                    status_map[tag] = {
                        "value": None,
                        "timestamp": None,
                        "Is Good": None,
                        "Questionable": None,
                        # "Annotated": None,
                        "Substituted": None,
                    }

        df_status = pd.DataFrame.from_dict(status_map, orient="index")
        df_status.index.name = "tag_name"
        df_status.reset_index(inplace=True)

        df_result = pd.merge(df_tags, df_status, on="tag_name", how="left")

        df_result["timestamp"] = (
            pd.to_datetime(df_result["timestamp"], errors="coerce")
        )

        df_result = df_result[[
            "tag_name",
            "description",
            "unit",
            "point_type",
            "value",
            "timestamp",
            "Is Good",
            "Questionable",
            # "Annotated",
            "Substituted",
        ]]

        return df_result


def _df_to_records(df: pd.DataFrame, tag: str) -> list[dict]:
    if tag not in df.columns:
        return []
    return [
        {"timestamp": str(row["timestamp"]), "value": row[tag]}
        for _, row in df.iterrows()
        if pd.notna(row.get(tag))
    ]
