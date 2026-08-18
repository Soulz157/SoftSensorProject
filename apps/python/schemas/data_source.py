"""
Request/response contracts for the per-source Data Source connectors
(/v1/data-sources/*). Unlike schemas/data.py these carry per-request
credentials supplied by NestJS (decrypted from DataSource.secretCiphertext) —
credentials are used to build a client for that one call and are never
persisted or logged here.
"""
from typing import Optional

from pydantic import BaseModel, Field

from schemas.data import (
    CalBasis,
    SummaryType,
    DataFetchResponse,
    TagListResponse,
    TagCurrentResponse,
)


# ── PI (AVEVA / OSIsoft) ─────────────────────────────────────────────────────

class PICredentials(BaseModel):
    api_server: str = Field(..., description="PI Web API base URL")
    pi_server: str = Field(..., description="PI Data Server name")
    user: str
    # repr=False: keep out of logs/reprs
    password: str = Field(..., repr=False)


class PITestRequest(BaseModel):
    credentials: PICredentials


class PITagsRequest(BaseModel):
    credentials: PICredentials
    name_filter: str = Field(
        "*", description="Wildcard filter, e.g. D1-* or *MEAS*")
    page: int = Field(1, ge=1, le=100)
    page_size: int = Field(40, ge=40,  le=10000)


class TagResolveRequest(BaseModel):
    credentials: PICredentials
    tag_list: list[str] = Field(..., min_length=1)


class PICurrentRequest(BaseModel):
    credentials: PICredentials
    tag_list: list[str] = Field(..., min_length=1)
    batch_size: int = Field(100, ge=1, le=1000)


class PIFetchRequest(BaseModel):
    credentials: PICredentials
    tag_list: list[str] = Field(..., min_length=1)
    start_time: str = Field(..., examples=["2026-06-22 00:00:00.000000"])
    end_time: str = Field(..., examples=["2026-06-22 01:00:00.000000"])
    cal_basis: CalBasis = CalBasis.time_weighted
    summary_type: list[SummaryType] = [SummaryType.average]
    summary_duration: Optional[str] = Field(None, examples=["1m"])
    batch_size: int = Field(300, ge=1, le=1000)


# ── SQL Database ─────────────────────────────────────────────────────────────

class SQLCredentials(BaseModel):
    driver: str = Field(..., description="postgres | mysql | mariadb")
    host: str
    port: int = Field(..., ge=1, le=65535)
    database: str
    user: str
    password: str = Field(..., repr=False)
    db_schema: Optional[str] = Field(
        None, alias="schema", description="Optional DB schema/namespace"
    )

    model_config = {"populate_by_name": True}


class SQLTestRequest(BaseModel):
    credentials: SQLCredentials


class SQLTablesRequest(BaseModel):
    credentials: SQLCredentials


class SQLColumnsRequest(BaseModel):
    credentials: SQLCredentials
    table: str


class SQLQueryRequest(BaseModel):
    credentials: SQLCredentials
    table: str
    columns: Optional[list[str]] = None
    time_column: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    limit: int = Field(1000, ge=1, le=50000)


class SQLColumn(BaseModel):
    name: str
    type: str


class SQLTablesResponse(BaseModel):
    tables: list[str]


class SQLColumnsResponse(BaseModel):
    columns: list[SQLColumn]


class SQLQueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    row_count: int


# ── Shared connector responses ───────────────────────────────────────────────

class ConnectionTestResponse(BaseModel):
    """Result of a connection test. `ok=False` is a normal 200 outcome (a bad
    connection), not an HTTP error — the caller relays `message` to the user."""
    ok: bool
    message: str


# Re-export the reused PI data/tag responses so the router imports from one place.
__all__ = [
    "PICredentials",
    "PITestRequest",
    "PITagsRequest",
    "PIFetchRequest",
    "SQLCredentials",
    "SQLTestRequest",
    "SQLTablesRequest",
    "SQLColumnsRequest",
    "SQLQueryRequest",
    "SQLColumn",
    "SQLTablesResponse",
    "SQLColumnsResponse",
    "SQLQueryResponse",
    "ConnectionTestResponse",
    "DataFetchResponse",
    "TagListResponse",
    "TagCurrentResponse",
    "PICurrentRequest",
]
