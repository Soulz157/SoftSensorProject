"""
Per-source Data Source connectors (/v1/data-sources/*).

These endpoints receive credentials in the request body from NestJS (decrypted
from DataSource.secretCiphertext) and are the server-to-server contract used by
apps/backend src/lib/python-client.ts. The browser never calls them directly.

PI (AVEVA) is implemented here. SQL and REST sub-routes are added by F4 / F5.
"""
import traceback

from fastapi import APIRouter, HTTPException

from config import settings
from intergrations.sql_connect import SQLConnectionError
from schemas.data_source import (
    ConnectionTestResponse,
    PICurrentRequest,
    PIFetchRequest,
    PITagsRequest,
    PITestRequest,
    SQLColumnsRequest,
    SQLColumnsResponse,
    SQLQueryRequest,
    SQLQueryResponse,
    SQLTablesRequest,
    SQLTablesResponse,
    SQLTestRequest,
)
from schemas.data import DataFetchResponse, TagListResponse, TagCurrentResponse
from services.data_source_service import PIDataSourceService, SQLDataSourceService

router = APIRouter(prefix="/v1/data-sources", tags=["DataSources"])

_pi = PIDataSourceService()
_sql = SQLDataSourceService()


# ── PI (AVEVA / OSIsoft) ─────────────────────────────────────────────────────

@router.post(
    "/pi/test",
    response_model=ConnectionTestResponse,
    summary="Test a PI Web API connection with the supplied credentials",
)
def pi_test(body: PITestRequest) -> ConnectionTestResponse:
    # Sync handler on purpose: FastAPI runs plain `def` in its threadpool, so a
    # slow PI host can no longer stall the event loop and every other request.
    print('asdasd')
    return _pi.test_connection(body.credentials)


@router.post(
    "/pi/tags",
    response_model=TagListResponse,
    summary="Search the PI tag catalog using the supplied credentials",
)
def pi_tags(body: PITagsRequest) -> TagListResponse:
    try:
        return _pi.list_tags(
            body.credentials,
            name_filter=body.name_filter,
            max_count=body.max_count,
        )
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {exc}")


@router.post(
    "/pi/current",
    response_model=TagCurrentResponse,
    summary="Current (snapshot) values + quality for selected tags",
)
def pi_current(body: PICurrentRequest) -> TagCurrentResponse:
    try:
        return _pi.current_values(
            body.credentials, body.tag_list, batch_size=body.batch_size
        )
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {exc}")


@router.post(
    "/pi/fetch",
    response_model=DataFetchResponse,
    summary="Batch-fetch PI time-series data using the supplied credentials",
)
async def pi_fetch(body: PIFetchRequest) -> DataFetchResponse:
    try:
        return await _pi.fetch(
            body,
            interval=body.summary_duration or settings.INTERVAL_TIME,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"PI Web API error: {exc}")


# ── SQL Database ─────────────────────────────────────────────────────────────

@router.post(
    "/sql/test",
    response_model=ConnectionTestResponse,
    summary="Test a SQL database connection with the supplied credentials",
)
def sql_test(body: SQLTestRequest) -> ConnectionTestResponse:
    # Config errors (bad driver) are still a failed-test result, not a 5xx.
    try:
        return _sql.test_connection(body.credentials)
    except SQLConnectionError as exc:
        return ConnectionTestResponse(ok=False, message=str(exc))


@router.post(
    "/sql/tables",
    response_model=SQLTablesResponse,
    summary="List tables in the SQL database",
)
def sql_tables(body: SQLTablesRequest) -> SQLTablesResponse:
    try:
        return _sql.list_tables(body.credentials)
    except SQLConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"SQL error: {exc}")


@router.post(
    "/sql/columns",
    response_model=SQLColumnsResponse,
    summary="List columns for a table in the SQL database",
)
def sql_columns(body: SQLColumnsRequest) -> SQLColumnsResponse:
    try:
        return _sql.get_columns(body.credentials, body.table)
    except SQLConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"SQL error: {exc}")


@router.post(
    "/sql/query",
    response_model=SQLQueryResponse,
    summary="Run a bounded, filtered SELECT for Dataset creation",
)
def sql_query(body: SQLQueryRequest) -> SQLQueryResponse:
    try:
        return _sql.query(body)
    except SQLConnectionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"SQL error: {exc}")
