# services/tag_service.py
import json
import pandas as pd
from schemas import TagListResponse, TagItem
from intergrations import PIWebAPI


def _to_tag_item(rec: dict) -> TagItem:
    return TagItem(
        tag_name=str(rec.get("tag_name", "")),
        description=rec.get("description") or None,
        value=rec.get("value"),
        unit=rec.get("unit") or None,
        isGood=rec.get("Is Good"),
        questionable=rec.get("Questionable"),
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
            records = json.loads(raw.to_json(orient="records"))
        else:
            records = list(raw)

        items = [_to_tag_item(r) for r in records]
        return TagListResponse(total=len(items), tags=items)
