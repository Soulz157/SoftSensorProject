# services/tag_service.py
import json
import pandas as pd
from schemas import TagListResponse, TagItem
from schemas.data import TagCurrent, TagCurrentResponse
from intergrations import PIWebAPI
from intergrations.aveva_connect import chunked


API_FIELD_MAP = {
    "tag_name": "tag_name",
    "description": "description",
    "unit": "unit",
    "point_type": "point_type",
    "value": "value",
    "timestamp": "timestamp",
    "Is Good": "is_good",
    "Questionable": "questionable",
    "Substituted": "substituted",
}


def tags_to_records(df: pd.DataFrame) -> list[dict]:
    out = df.copy()
    out["timestamp"] = out["timestamp"].apply(
        lambda t: t.isoformat() if pd.notna(t) else None)
    # digital point (XV-101 OPEN/CLOSED) คืน value เป็น object ไม่ใช่ scalar
    # ถ้าไม่ flatten frontend จะ render [object Object]
    out["value"] = out["value"].apply(
        lambda v: v.get("Name") if isinstance(v, dict) else v)
    out = out.rename(columns=API_FIELD_MAP)[list(API_FIELD_MAP.values())]
    return out.astype(object).where(pd.notna(out), None).to_dict(orient="records")


def _to_tag_item(rec: dict) -> TagItem:
    return TagItem(
        tag_name=str(rec.get("tag_name", "")),
        description=rec.get("description") or None,
        value=rec.get("value"),
        unit=rec.get("unit") or None,
        point_type=rec.get("point_type") or None,
        isGood=rec.get("is_good"),
        questionable=rec.get("questionable"),
        substituted=rec.get("substituted"),
        timestamp=rec.get("timestamp") or None,
    )


class TagService:
    def __init__(self, webapi: PIWebAPI):
        self.webapi = webapi

    def list_tags(
        self, name_filter: str = "*", page: int = 1,
        page_size: int = 1_000, batch_size: int = 100
    ) -> TagListResponse:
        if page < 1:
            raise ValueError("page must be >= 1")

        start_index = (page - 1) * page_size
        raw = self.webapi.search_tags(
            name_filter=name_filter, start_index=start_index, page_size=page_size, batch_size=batch_size
        )

        items = [_to_tag_item(r) for r in tags_to_records(raw.df)]
        return TagListResponse(
            count=len(items),
            page=page,
            page_size=page_size,
            hasNext=raw.has_next,
            tags=items,
        )

    def current_values(
        self, tag_list: list[str], batch_size: int = 100
    ) -> TagCurrentResponse:
        """Snapshot (current) value + quality per tag — NO archive read.

        Mirrors the snapshot-with-quality call in PIWebAPI.search_tags: one
        batched ad-hoc streamSet read selecting value/timestamp/good/
        questionable/substituted. A failed batch yields null entries for its
        tags rather than aborting the whole request.
        """
        client = self.webapi.client
        pi_server = self.webapi.pi_server
        out: list[TagCurrent] = []

        for chunk in chunked(list(tag_list), batch_size):
            try:
                paths = [f"pi:\\\\{pi_server}\\{tag}" for tag in chunk]
                webids = client.data.convert_paths_to_web_ids(paths)
                snapshot = client.streamSet.get_values_ad_hoc(
                    web_id=webids,
                    selected_fields=(
                        "items.name;"
                        "items.value.value;"
                        "items.value.timestamp;"
                        "items.value.good;"
                        "items.value.questionable;"
                        "items.value.substituted"
                    ),
                )
                for item in snapshot.items:
                    val = item.value
                    ts = getattr(val, "timestamp", None)
                    out.append(
                        TagCurrent(
                            tag_name=item.name,
                            value=getattr(val, "value", None),
                            timestamp=str(ts) if ts is not None else None,
                            isGood=getattr(val, "good", None),
                            questionable=getattr(val, "questionable", None),
                            substituted=getattr(val, "substituted", None),
                        )
                    )
            except Exception:  # noqa: BLE001 — degrade the batch, don't abort
                out.extend(TagCurrent(tag_name=tag) for tag in chunk)

        return TagCurrentResponse(tags=out)
