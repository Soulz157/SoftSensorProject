from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class CalBasis(str, Enum):
    time_weighted = "TimeWeighted"
    event_weighted = "EventWeighted"
    time_weighted_cont = "TimeWeightedContinuous"


class SummaryType(str, Enum):
    average = "Average"
    minimum = "Minimum"
    maximum = "Maximum"
    total = "Total"
    std_dev = "StdDev"
    count = "Count"


class TagItem(BaseModel):
    tag_name: str
    description: Optional[str] = None
    value: Optional[float | str | dict] = None
    unit: Optional[str] = None
    point_type: Optional[str] = None
    isGood: Optional[bool] = None
    questionable: Optional[bool] = None
    substituted: Optional[bool] = None
    # Snapshot (current-value) timestamp — NOT an archive read.
    timestamp: Optional[str] = None


class TagListResponse(BaseModel):
    total: int
    tags: list[TagItem]


class TagCurrent(BaseModel):
    """Current (snapshot) value + quality for one tag. Snapshot read, not archive."""
    tag_name: str
    value: Optional[float | str | dict] = None
    timestamp: Optional[str] = None
    isGood: Optional[bool] = None
    questionable: Optional[bool] = None
    substituted: Optional[bool] = None


class TagCurrentRequest(BaseModel):
    tag_list: list[str] = Field(..., min_length=1)
    batch_size: int = Field(
        100, ge=1, le=1000, description="Tags per snapshot batch")


class TagCurrentResponse(BaseModel):
    tags: list[TagCurrent]


class DataFetchRequest(BaseModel):
    tag_list: list[str] = Field(..., min_length=1,
                                description="List of PI tag names")
    start_time: str = Field(...,  examples="2026-06-22 00:00:00.000000")
    end_time: str = Field(...,  examples="2026-06-22 01:00:00.000000")
    cal_basis: CalBasis = CalBasis.time_weighted
    summary_type: list[SummaryType] = [SummaryType.average]
    summary_duration: Optional[str] = Field(None, examples="1m")
    batch_size: int = Field(300, ge=1, le=1000, description="Tags per batch")


class TagDataPoint(BaseModel):
    timestamp: str
    value: float | str | None


class TagDataResult(BaseModel):
    tag_name: str
    data: list[TagDataPoint]
    status: str = "ok"          # "ok" | "partial" | "failed"
    error: Optional[str] = None


class DataFetchResponse(BaseModel):
    start_time: str
    end_time: str
    total_tags: int
    succeeded_tags: int
    failed_tags: int
    batch_size: int
    results: list[TagDataResult]
