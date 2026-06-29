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
    unit: Optional[str] = None
    plant: Optional[str] = None


class TagListResponse(BaseModel):
    total: int
    tags: list[TagItem]


class DataFetchRequest(BaseModel):
    tag_list: list[str] = Field(..., min_length=1,
                                description="List of PI tag names")
    start_time: str = Field(...,  example="2026-06-22 00:00:00.000000")
    end_time: str = Field(...,  example="2026-06-22 01:00:00.000000")
    cal_basis: CalBasis = CalBasis.time_weighted
    summary_type: list[SummaryType] = [SummaryType.average]
    summary_duration: Optional[str] = Field(None, example="1m")
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
