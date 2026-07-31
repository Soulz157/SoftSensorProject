# services/tag_service.py
import json
import pandas as pd
from schemas import TagListResponse, TagItem
from schemas.data import TagCurrent, TagCurrentResponse
from intergrations import PIWebAPI
from intergrations.aveva_connect import chunked


def _to_tag_item(rec: dict) -> TagItem:
    return TagItem(
        tag_name=str(rec.get("tag_name", "")),
        description=rec.get("description") or None,
        value=rec.get("value"),
        unit=rec.get("unit") or None,
        point_type=rec.get("point_type") or None,
        isGood=rec.get("Is Good"),
        questionable=rec.get("Questionable"),
        substituted=rec.get("Substituted"),
        timestamp=rec.get("timestamp") or None,
    )


class TagService:
    def __init__(self, webapi: PIWebAPI):
        self.webapi = webapi

    def list_tags(
        self, name_filter: str = "*", max_count: int = 10, batch_size: int = 100
    ) -> TagListResponse:
        raw = self.webapi.search_tags(
            name_filter=name_filter, max_count=max_count, batch_size=batch_size
        )

        if isinstance(raw, pd.DataFrame):
            # date_format="iso" → the snapshot `timestamp` column serializes as an
            # ISO string (not epoch ms), matching TagItem.timestamp: Optional[str].
            records = json.loads(raw.to_json(orient="records", date_format="iso"))
        else:
            records = list(raw)

        items = [_to_tag_item(r) for r in records]
        return TagListResponse(total=len(items), tags=items)

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
