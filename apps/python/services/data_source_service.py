"""
Per-source PI (AVEVA) connector service.

Builds a PIWebAPI client from credentials supplied on the request (decrypted by
NestJS from DataSource.secretCiphertext) and reuses the existing TagService /
DataService logic. The env-cred singleton in dependencies.py is intentionally
bypassed so a user's own credentials authenticate the call.

Credentials are never logged. Upstream PI error text may include the API server
URL / HTTP status (not the password) and is truncated before it leaves here.
"""
from intergrations import PIWebAPI
from intergrations.pi_http import (
    FETCH_TIMEOUT,
    METADATA_TIMEOUT,
    TEST_TIMEOUT,
    pi_timeout,
)
from intergrations.sql_connect import SQLDataSource
from schemas.data import DataFetchRequest, DataFetchResponse, TagListResponse
from schemas.data_source import (
    ConnectionTestResponse,
    PICredentials,
    PIFetchRequest,
    SQLColumn,
    SQLColumnsResponse,
    SQLCredentials,
    SQLQueryRequest,
    SQLQueryResponse,
    SQLTablesResponse,
    TagCurrentResponse,
)
from services.data_service import DataService
from services.tag_service import TagService


def build_pi_client(creds: PICredentials) -> PIWebAPI:
    """One PIWebAPI per request — no lru_cache, no env credentials."""
    return PIWebAPI(
        api_server=creds.api_server,
        user=creds.user,
        pwd=creds.password,
        pi_server=creds.pi_server,
    )


def _safe_message(exc: Exception) -> str:
    text = str(exc) or repr(exc)
    return text[:300]


class PIDataSourceService:
    def test_connection(self, creds: PICredentials) -> ConnectionTestResponse:
        client = build_pi_client(creds)
        try:
            # Bounded so an unresponsive PI host fails inside the caller's 15s
            # budget with a real reason, instead of hanging the worker.
            with pi_timeout(TEST_TIMEOUT):
                server = client.client.dataServer.get_by_name(
                    name=creds.pi_server
                )
        except Exception as exc:
            return ConnectionTestResponse(ok=False, message=_safe_message(exc))
        if server is None:
            return ConnectionTestResponse(
                ok=False,
                message=(
                    f"PI data server '{creds.pi_server}' not found or not "
                    "visible to this account."
                ),
            )
        return ConnectionTestResponse(
            ok=True, message=f"Connected to PI data server '{creds.pi_server}'."
        )

    def list_tags(
        self, creds: PICredentials, name_filter: str, max_count: int
    ) -> TagListResponse:
        client = build_pi_client(creds)
        with pi_timeout(METADATA_TIMEOUT):
            return TagService(client).list_tags(
                name_filter=name_filter, max_count=max_count
            )

    def current_values(
        self, creds: PICredentials, tag_list: list[str], batch_size: int
    ) -> TagCurrentResponse:
        client = build_pi_client(creds)
        with pi_timeout(METADATA_TIMEOUT):
            return TagService(client).current_values(
                tag_list, batch_size=batch_size
            )

    async def fetch(
        self, body: PIFetchRequest, interval: str
    ) -> DataFetchResponse:
        client = build_pi_client(body.credentials)
        data_body = DataFetchRequest(
            tag_list=body.tag_list,
            start_time=body.start_time,
            end_time=body.end_time,
            cal_basis=body.cal_basis,
            summary_type=body.summary_type,
            summary_duration=body.summary_duration,
            batch_size=body.batch_size,
        )
        # DataService offloads each PI call via asyncio.to_thread, which copies
        # this context — so the budget reaches the worker threads.
        with pi_timeout(FETCH_TIMEOUT):
            return await DataService(client).fetch(data_body, interval=interval)


def _build_sql(creds: SQLCredentials) -> SQLDataSource:
    return SQLDataSource(
        driver=creds.driver,
        host=creds.host,
        port=creds.port,
        database=creds.database,
        user=creds.user,
        password=creds.password,
        schema=creds.db_schema,
    )


class SQLDataSourceService:
    def test_connection(self, creds: SQLCredentials) -> ConnectionTestResponse:
        ok, message = _build_sql(creds).test_connection()
        return ConnectionTestResponse(ok=ok, message=message)

    def list_tables(self, creds: SQLCredentials) -> SQLTablesResponse:
        return SQLTablesResponse(tables=_build_sql(creds).list_tables())

    def get_columns(
        self, creds: SQLCredentials, table: str
    ) -> SQLColumnsResponse:
        cols = _build_sql(creds).get_columns(table)
        return SQLColumnsResponse(
            columns=[SQLColumn(name=c["name"], type=c["type"]) for c in cols]
        )

    def query(self, body: SQLQueryRequest) -> SQLQueryResponse:
        result = _build_sql(body.credentials).query(
            table=body.table,
            columns=body.columns,
            time_column=body.time_column,
            start_time=body.start_time,
            end_time=body.end_time,
            limit=body.limit,
        )
        return SQLQueryResponse(**result)
