import os
import time
import logging
import requests
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

    def __init__(self, api_server: str, user: str, pwd: str, pi_server: str):
        self.client = PIWebApiClient(
            api_server, False, user, pwd, False, True)
        self.api_server = api_server
        self.pi_server = pi_server

    def _resolve_data_server(self):
        try:
            data_server = self.client.dataServer.get_by_name(
                name=self.pi_server)
        except Exception as e:
            status = getattr(e, "status", None)   # ApiException carries these
            body = getattr(e, "body", None)
            raise RuntimeError(
                f"Could not reach/authenticate PI Web API at '{self.api_server}' "
                f"while resolving Data Server '{self.pi_server}'. "
                f"HTTP status={status}. Check base URL, credentials, and network. "
                f"Detail: {body or e}"
            ) from e

        if data_server is None:
            raise RuntimeError(
                f"Data Server '{self.pi_server}' resolved to None — the name is "
                f"likely wrong or not visible to this account."
            )
        return data_server

    def convertPathtoWebIds(self, path: list):
        try:
            paths = ["pi:\\\\" + self.pi_server +
                     "\\" + x for i, x in enumerate(path)]
            # print(f"Converting paths to Web IDs: {paths}")
            webIds = self.client.data.convert_paths_to_web_ids(paths)
            # print(f"Converted Web IDs: {webIds}")
            return webIds
        except Exception as e:
            print(f"Error converting paths to Web IDs: {e}")
            return []

    def convertAverageDicttoDataFrame(self, data, tag_list: list):
        columns = ["timestamp"] + list(tag_list)
        n_tags = len(tag_list)
        row_count = len(data.items[0].items)

        lst_main = []
        for i in range(row_count):
            # timestamp อ้างจาก tag แรก (ทุก tag แชร์ grid เวลาเดียวกัน)
            row = [data.items[0].items[i].value.timestamp]
            for t in range(n_tags):
                row.append(data.items[t].items[i].value.value)
            lst_main.append(row)

        df = pd.DataFrame(lst_main, columns=columns)
        df["timestamp"] = (
            pd.to_datetime(df["timestamp"], format="ISO8601", utc=True)
            .dt.tz_convert("Asia/Bangkok")
            .dt.tz_localize(None)
        )
        return df

    def getAverageValue(
        self,
        tag_list: list,
        start_time: str,
        end_time: str,
        cal_basis: str,
        summary_type: list,
        summary_duration: str = None,
        filter_expression=None,
    ):
        webIds = self.convertPathtoWebIds(tag_list)
        df = self.client.streamSet.get_summaries_ad_hoc(
            web_id=webIds,
            start_time=start_time,
            end_time=end_time,
            calculation_basis=cal_basis,
            summary_type=summary_type,
            summary_duration=summary_duration,
        )
        df = self.convertAverageDicttoDataFrame(df, tag_list)
        return df

    def getSnapshotValue(self, tag: list):
        webIds = self.convertPathtoWebIds(tag)
        data = self.client.streamSet.get_values_ad_hoc(web_id=webIds, time="*")
        data = self.convertSnapshotDicttoDataFrame(data, tag)
        self.client.point.get_attributes()
        return data

    def convertSnapshotDicttoDataFrame(self, data, tag_list: list):
        columns = ["timestamp"] + list(tag_list)
        lst_main = list()
        lst_sub = list()
        j = 0
        while j < len(tag_list):
            if j == 0:
                lst_sub.append(data.items[0].value.timestamp)
            else:
                lst_sub.append(data.items[j - 1].value.value)
            j = j + 1
        lst_main.append(lst_sub)

        df = pd.DataFrame(lst_main, columns=columns)
        df["timestamp"] = pd.to_datetime(
            df["timestamp"], format="%Y-%m-%dT%H:%M:%S.%fZ"
        ) + pd.to_timedelta("07:00:00")
        return df

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

    def search_tags(
        self,
        name_filter: str = "*",
        max_count: int = 10,
        batch_size: int = 100,
    ) -> pd.DataFrame:
        data_server = self._resolve_data_server()

        points = self.client.dataServer.get_points(
            web_id=data_server.web_id,
            name_filter=name_filter,
            max_count=max_count,
            selected_fields=(
                "items.name;"
                "items.descriptor;"
                "items.engineeringUnits;"
                "items.pointType;"
                "items.webId"
            ),
        )

        rows = []
        webid_by_tag: dict[str, str] = {}
        for item in points.items:
            rows.append({
                "tag_name": item.name,
                "description": item.descriptor,
                "unit": item.engineering_units,
                "point_type": item.point_type,
            })
            webid_by_tag[item.name] = item.web_id

        df_tags = pd.DataFrame(rows)

        tag_names = df_tags["tag_name"].tolist()

        # If this PI Web API version ignores `items.webId`, every snapshot call
        # below would fail and the per-chunk except would fill quality with
        # nulls — description/unit would still render, so the table would look
        # fine while Status/Quest./Subst. were silently empty. Fail loudly.
        if tag_names and not any(webid_by_tag.get(t) for t in tag_names):
            raise RuntimeError(
                "PI returned no webId for any point — cannot read snapshot "
                "quality. Check that this PI Web API version honours the "
                "'items.webId' selected field."
            )

        # ── Step 2 : ดึง Is Good จาก Snapshot (batch) ─────────
        status_map: dict[str, bool] = {}

        for chunk in chunked(tag_names, batch_size):
            try:
                # Reuse the webIds from get_points. convert_paths_to_web_ids
                # issued one HTTP GET per tag (SDK data_api.py:42), making this
                # N+1: ~1012 requests for 1000 tags (~30s, past the caller's
                # timeout). Now the whole call is 2 + ceil(N/batch_size).
                webids = [webid_by_tag[tag] for tag in chunk]

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

    def inspect_tag_attributes(
        self,
        name_filter: str = "D1-PI9121A.MEAS",
    ) -> None:
        data_server = self.client.dataServer.get_by_name(name=self.pi_server)

        points = self.client.dataServer.get_points(
            web_id=data_server.web_id,
            name_filter=name_filter,
            max_count=1,
            # ไม่ใส่ selected_fields → ดึงมาทุก field
        )

        if not points.items:
            print("❌ ไม่พบ tag")
            return

        item = points.items[0]

        print(f"\n{'─'*50}")
        print(f"  Tag : {item.name}")
        print(f"{'─'*50}")

        print("\n📌 [__dict__]")
        for k, v in vars(item).items():
            print(f"  {k:<35} = {v}")

        print("\n📌 [to_dict()]")
        try:
            for k, v in item.to_dict().items():
                print(f"  {k:<35} = {v}")
        except Exception as e:
            print(f"  ⚠️  to_dict() ไม่รองรับ — {e}")

        # ── วิธีที่ 3 : __dict__ raw json ─────────────────────
        print("\n📌 [Raw JSON via __dict__ keys]")
        print(f"  Keys : {list(vars(item).keys())}")

    def convertAttributeValuestoDataFrame(self, data, tag_list: list):
        tag_list.insert(0, "timestamp")
        lst_main = list()
        lst_sub = list()
        j = 0
        while j < len(tag_list):
            if j == 0:
                lst_sub.append(data.items[0].items[0].value.timestamp)
            else:
                lst_sub.append(data.items[j - 1].items[0].value.value)
            j = j + 1
        lst_main.append(lst_sub)

        df = pd.DataFrame(lst_main, columns=tag_list)
        df["timestamp"] = pd.to_datetime(
            df["timestamp"], format="%Y-%m-%dT%H:%M:%S.%fZ"
        ) + pd.to_timedelta("07:00:00")
        return df

    def getAttributeValues(self, path: list, asset_server: str):
        paths = ["af:\\\\" + asset_server +
                 "\\" + x for i, x in enumerate(path)]
        webIds = self.client.data.convert_paths_to_web_ids(paths)
        data = self.client.streamSet.get_summaries_ad_hoc(web_id=webIds)
        data = self.convertAttributeValuestoDataFrame(data, path)
        return data

    def getRecordedValues(self, tag_list: list, start_time: str, end_time: str):
        webIds = self.convertPathtoWebIds(tag_list)
        df = self.client.streamSet.get_recorded_ad_hoc(
            web_id=webIds,
            start_time=start_time,
            end_time=end_time,
            selected_fields="items.name;items.items.timestamp;items.items.value",
        )
        pass

    def convertInterpolatedDicttoDataFrame(self, data, tag_list: list):
        tag_list.insert(0, "timestamp")
        i = 0
        lst_main = list()

        while i < len(data.items[0].items):
            lst_sub = list()
            j = 0
            while j < len(tag_list):
                if j == 0:
                    lst_sub.append(data.items[0].items[i].timestamp)
                else:
                    lst_sub.append(data.items[j - 1].items[i].value)
                j = j + 1
            lst_main.append(lst_sub)
            i = i + 1

        df = pd.DataFrame(lst_main, columns=tag_list)
        df["timestamp"] = pd.to_datetime(
            df["timestamp"], format="%Y-%m-%dT%H:%M:%S.%fZ"
        ) + pd.to_timedelta("07:00:00")
        return df

    def getInterpolatedValue(
        self, tag_list: list, start_time: str, end_time: str, summary_duration: str
    ):
        webIds = self.convertPathtoWebIds(tag_list)
        df = self.client.streamSet.get_interpolated_ad_hoc(
            web_id=webIds,
            start_time=start_time,
            end_time=end_time,
            interval=summary_duration,
        )
        df = self.convertInterpolatedDicttoDataFrame(df, tag_list)
        return df

    # ── Public: get average (single batch) ────────────────
    def getAverageValue(
        self,
        tag_list: list,
        start_time: str,
        end_time: str,
        cal_basis: str,
        summary_type: list,
        summary_duration: str = None,
        filter_expression=None,
    ):
        webIds = self.convertPathtoWebIds(tag_list)
        df = self.client.streamSet.get_summaries_ad_hoc(
            web_id=webIds,
            start_time=start_time,
            end_time=end_time,
            calculation_basis=cal_basis,
            summary_type=summary_type,
            summary_duration=summary_duration,
        )
        df = self.convertAverageDicttoDataFrame(df, tag_list)
        return df

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

    def fetch_tags_in_batches(
        self,
        tag_list: list,
        start_time: str,
        end_time: str,
        cal_basis: str,
        cal_type: list = ["Average"],
        interval: str = '1m',
        batch_size: int = 300,       # ← ปรับได้ (300 / 500 / 800)
        max_retry: int = 3,
        retry_delay: float = 2.0,
    ) -> Optional[pd.DataFrame]:
        """
        Pull data from PI Web API in batches.

        Returns
        -------
        pd.DataFrame  : merged result of all batches (join on 'timestamp')
        None          : if every batch+tag completely fails
        """
        webapi = self
        all_frames: list[pd.DataFrame] = []
        chunks = list(chunked(tag_list, batch_size))

        print(f"📦 Total tags : {len(tag_list)}")
        print(f"📦 Batch size : {batch_size}")
        print(f"📦 Chunks     : {len(chunks)}")
        print("─" * 45)

        for idx, chunk in enumerate(chunks, start=1):
            print(f"\n🔄 Chunk {idx}/{len(chunks)}  ({len(chunk)} tags)")

            df_chunk: Optional[pd.DataFrame] = None

            # ── Attempt 1: Batch call ───────────────────────────
            for attempt in range(1, max_retry + 1):
                try:
                    df_chunk = webapi.getAverageValue(
                        chunk.copy(), start_time, end_time, cal_basis, cal_type, interval
                    )
                    print(f"   ✅ Batch OK  (attempt {attempt})")
                    break
                except Exception as e:
                    print(f"   ⚠️  Attempt {attempt}/{max_retry} failed — {e}")
                    if attempt < max_retry:
                        time.sleep(retry_delay)

            # ── Fallback: Tag-by-tag ────────────────────────────
            if df_chunk is None:
                print("   🔁 Falling back to tag-by-tag...")
                tag_frames: list[pd.DataFrame] = []

                for tag in chunk:
                    tag_ok = False
                    for attempt in range(1, max_retry + 1):
                        try:
                            df_tag = webapi.getAverageValue(
                                [tag], start_time, end_time, cal_basis, cal_type, interval
                            )
                            tag_frames.append(df_tag)
                            print(f"      ✅ {tag}")
                            tag_ok = True
                            break
                        except Exception as e:
                            print(f"      ⚠️  {tag} attempt {attempt} — {e}")
                            if attempt < max_retry:
                                time.sleep(retry_delay)

                    if not tag_ok:
                        print(
                            f"      ❌ {tag} — skipped after {max_retry} retries")

                if tag_frames:
                    # Merge tag frames on timestamp
                    df_chunk = tag_frames[0]
                    for df_next in tag_frames[1:]:
                        df_chunk = pd.merge(
                            df_chunk, df_next, on="timestamp", how="outer"
                        )

            if df_chunk is not None and not df_chunk.empty:
                all_frames.append(df_chunk)
            else:
                print(f"   ⛔ Chunk {idx} yielded no data — skipping")

        if not all_frames:
            return None

        # ── Merge all chunks ────────────────────────────────────
        df_final = all_frames[0]
        for df_next in all_frames[1:]:
            df_final = pd.merge(df_final, df_next, on="timestamp", how="outer")

        df_final.sort_values("timestamp", inplace=True)
        df_final.reset_index(drop=True, inplace=True)
        return df_final

    # ── Public: Search tags from PI Point ─────────────────
    # def search_tags(
    #     self,
    #     name_filter: str = "*",
    #     max_count: int = 10,
    #     batch_size: int = 100,
    # ) -> pd.DataFrame:
    #     print(
    #         f"Searching tags with filter: {name_filter} (max_count={max_count})")

    #     web_id = self.convertPathtoWebIds["*"]
    #     print(
    #         f"Found Data Server: {web_id} ")

    #     points = self.client.dataServer.get_points(
    #         web_id=web_id,
    #         name_filter=name_filter,
    #         max_count=max_count,
    #         selected_fields=(
    #             "items.name;"
    #             "items.descriptor;"
    #             "items.engineeringUnits;"
    #             "items.pointType"
    #         ),
    #     )

    #     rows = []
    #     for item in points.items:
    #         rows.append({
    #             "tag_name": item.name,
    #             "description": item.descriptor,
    #             "unit": item.engineering_units,
    #             "point_type": item.point_type,
    #         })

    #     df_tags = pd.DataFrame(rows)

    #     tag_names = df_tags["tag_name"].tolist()

    #     # ── Step 2 : ดึง Is Good จาก Snapshot (batch) ─────────
    #     status_map: dict[str, bool] = {}

    #     for chunk in chunked(tag_names, batch_size):
    #         try:
    #             paths = [f"pi:\\\\{self.pi_server}\\{tag}" for tag in chunk]
    #             webids = self.client.data.convert_paths_to_web_ids(paths)

    #             snapshot = self.client.streamSet.get_values_ad_hoc(
    #                 web_id=webids,
    #                 selected_fields=(
    #                     "items.name;"
    #                     "items.value.value;"
    #                     "items.value.timestamp;"
    #                     "items.value.good;"
    #                     "items.value.questionable;"
    #                     # "items.value.annotated;"
    #                     "items.value.substituted"
    #                 ),
    #             )

    #             for item in snapshot.items:
    #                 val = item.value
    #                 status_map[item.name] = {
    #                     "value": val.value,
    #                     "timestamp": val.timestamp,
    #                     "Is Good": val.good,
    #                     "Questionable": val.questionable,
    #                     # "Annotated": val.annotated,
    #                     "Substituted": getattr(val, "substituted", None),
    #                 }

    #         except Exception as e:
    #             print(f"⚠️  Snapshot batch failed — {e}")
    #             for tag in chunk:
    #                 status_map[tag] = {
    #                     "value": None,
    #                     "timestamp": None,
    #                     "Is Good": None,
    #                     "Questionable": None,
    #                     # "Annotated": None,
    #                     "Substituted": None,
    #                 }

    #     df_status = pd.DataFrame.from_dict(status_map, orient="index")
    #     df_status.index.name = "tag_name"
    #     df_status.reset_index(inplace=True)

    #     df_result = pd.merge(df_tags, df_status, on="tag_name", how="left")

    #     df_result["timestamp"] = (
    #         pd.to_datetime(df_result["timestamp"], errors="coerce")
    #     )

    #     df_result = df_result[[
    #         "tag_name",
    #         "description",
    #         "unit",
    #         "point_type",
    #         "value",
    #         "timestamp",
    #         "Is Good",
    #         "Questionable",
    #         # "Annotated",
    #         "Substituted",
    #     ]]

    #     return df_result


def _df_to_records(df: pd.DataFrame, tag: str) -> list[dict]:
    if tag not in df.columns:
        return []
    return [
        {"timestamp": str(row["timestamp"]), "value": row[tag]}
        for _, row in df.iterrows()
        if pd.notna(row.get(tag))
    ]
