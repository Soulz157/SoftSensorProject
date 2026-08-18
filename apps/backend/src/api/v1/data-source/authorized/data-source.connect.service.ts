import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { decryptSecret } from '@/lib/crypto';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import type {
  AdHocSourceDto,
  FetchParamsDto,
  MetadataParamsDto,
  ResolveTagsDto,
  TagsCurrentDto,
} from './dto/data-source.connect.dto';

/**
 * Live-connection service for Data Sources.
 *
 * Loads a saved source (or takes ad-hoc creds), decrypts the secret, maps the
 * row to the connector's credential contract, and calls the FastAPI connector
 * via python-client.ts. The decrypted secret exists only in memory for the
 * duration of the call and is never returned to the client or logged.
 *
 * REST NOTE: the `api` (REST) credential body below is an ASSUMED contract — the
 * Python REST connector is being built separately. When it lands, reconcile the
 * field names in `buildRestCredentials` / the /rest/* paths with its schema.
 */

type SourceType = 'aveva' | 'sql' | 'csv' | 'api';

interface ResolvedSource {
  type: SourceType;
  host: string;
  username: string;
  dbName: string;
  /** Decrypted plaintext secret — in memory only. */
  secret: string;
  config: Record<string, unknown>;
}

interface ConnectionTestResponse {
  ok: boolean;
  message: string;
}

@Injectable()
export class DataSourceConnectService {
  constructor(private readonly prisma: PrismaService) {}

  // ── public ops ─────────────────────────────────────────────────────────────

  async testConnectionById(userId: string, id: string) {
    return this.testConnection(await this.resolveById(userId, id));
  }

  async testConnectionAdHoc(dto: AdHocSourceDto) {
    return this.testConnection(this.resolveAdHoc(dto));
  }

  async metadataById(userId: string, id: string, params: MetadataParamsDto) {
    return this.metadata(await this.resolveById(userId, id), params);
  }

  async fetchById(userId: string, id: string, params: FetchParamsDto) {
    return this.fetchData(await this.resolveById(userId, id), params);
  }

  /** Current (snapshot) values + quality for selected PI tags — PI sources only. */
  async tagsCurrentById(userId: string, id: string, params: TagsCurrentDto) {
    const src = await this.resolveById(userId, id);
    if (src.type !== 'aveva') {
      throw new AppException({
        statusCode: 400,
        message: 'Current-value lookup is only available for PI sources.',
        type: 'ERROR',
      });
    }
    const res = await postToPython(
      '/v1/data-sources/pi/current',
      {
        credentials: this.buildPiCredentials(src),
        tag_list: params.tagList,
        ...(params.batchSize && { batch_size: params.batchSize }),
      },
      PYTHON_TIMEOUT.metadata,
    );
    return this.ok(res);
  }

  // ── source resolution ──────────────────────────────────────────────────────

  private async resolveById(
    userId: string,
    id: string,
  ): Promise<ResolvedSource> {
    const row = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!row || row.createdById !== userId) {
      throw new AppException({
        statusCode: 404,
        message: 'Data source not found',
        type: 'ERROR',
      });
    }
    return {
      type: row.type as SourceType,
      host: row.host,
      username: row.username,
      dbName: row.dbName,
      secret: decryptSecret(row.secretCiphertext),
      config: this.asRecord(row.config),
    };
  }

  private resolveAdHoc(dto: AdHocSourceDto): ResolvedSource {
    return {
      type: dto.type,
      host: dto.host ?? '',
      username: dto.username ?? '',
      dbName: dto.dbName ?? '',
      secret: dto.password ?? '',
      config: dto.config ?? {},
    };
  }

  // ── dispatch by type ───────────────────────────────────────────────────────

  private async testConnection(src: ResolvedSource) {
    const [path, body] = this.testTarget(src);
    const res = await postToPython<ConnectionTestResponse>(
      path,
      body,
      PYTHON_TIMEOUT.test,
    );
    return this.ok(res);
  }

  private testTarget(src: ResolvedSource): [string, unknown] {
    switch (src.type) {
      case 'aveva':
        return [
          '/v1/data-sources/pi/test',
          { credentials: this.buildPiCredentials(src) },
        ];
      case 'sql':
        return [
          '/v1/data-sources/sql/test',
          { credentials: this.buildSqlCredentials(src) },
        ];
      case 'api':
        return [
          '/v1/data-sources/rest/test',
          { credentials: this.buildRestCredentials(src) },
        ];
      default:
        throw this.unsupported(src.type);
    }
  }

  private async metadata(src: ResolvedSource, params: MetadataParamsDto) {
    switch (src.type) {
      case 'aveva': {
        const res = await postToPython(
          '/v1/data-sources/pi/tags',
          {
            credentials: this.buildPiCredentials(src),
            name_filter: params.nameFilter ?? '*',
            page: params.page ?? 1,
            page_size: params.pageSize ?? 200,
          },
          PYTHON_TIMEOUT.metadata,
        );
        return this.ok(res);
      }
      case 'sql': {
        // With a table → its columns; without → the table list.
        const credentials = this.buildSqlCredentials(src);
        const res = params.table
          ? await postToPython(
              '/v1/data-sources/sql/columns',
              { credentials, table: params.table },
              PYTHON_TIMEOUT.metadata,
            )
          : await postToPython(
              '/v1/data-sources/sql/tables',
              { credentials },
              PYTHON_TIMEOUT.metadata,
            );
        return this.ok(res);
      }
      case 'api': {
        // No metadata catalog for REST — validating the endpoint is the test.
        const res = await postToPython<ConnectionTestResponse>(
          '/v1/data-sources/rest/test',
          { credentials: this.buildRestCredentials(src) },
          PYTHON_TIMEOUT.metadata,
        );
        return this.ok(res);
      }
      default:
        throw this.unsupported(src.type);
    }
  }

  private async fetchData(src: ResolvedSource, params: FetchParamsDto) {
    switch (src.type) {
      case 'aveva': {
        if (!params.tagList?.length || !params.startTime || !params.endTime) {
          throw new AppException({
            statusCode: 400,
            message:
              'tagList, startTime and endTime are required for PI fetch.',
            type: 'ERROR',
          });
        }
        const res = await postToPython(
          '/v1/data-sources/pi/fetch',
          {
            credentials: this.buildPiCredentials(src),
            tag_list: params.tagList,
            start_time: params.startTime,
            end_time: params.endTime,
            ...(params.calBasis && { cal_basis: params.calBasis }),
            ...(params.summaryType && { summary_type: params.summaryType }),
            ...(params.summaryDuration && {
              summary_duration: params.summaryDuration,
            }),
            ...(params.batchSize && { batch_size: params.batchSize }),
          },
          PYTHON_TIMEOUT.fetch,
        );
        return this.ok(res);
      }
      case 'sql': {
        if (!params.table) {
          throw new AppException({
            statusCode: 400,
            message: 'table is required for SQL fetch.',
            type: 'ERROR',
          });
        }
        const res = await postToPython(
          '/v1/data-sources/sql/query',
          {
            credentials: this.buildSqlCredentials(src),
            table: params.table,
            ...(params.columns && { columns: params.columns }),
            ...(params.timeColumn && { time_column: params.timeColumn }),
            ...(params.startTime && { start_time: params.startTime }),
            ...(params.endTime && { end_time: params.endTime }),
            ...(params.limit && { limit: params.limit }),
          },
          PYTHON_TIMEOUT.fetch,
        );
        return this.ok(res);
      }
      case 'api': {
        const res = await postToPython(
          '/v1/data-sources/rest/fetch',
          {
            credentials: this.buildRestCredentials(src),
            ...(params.jsonPath && { json_path: params.jsonPath }),
            ...(params.limit && { limit: params.limit }),
          },
          PYTHON_TIMEOUT.fetch,
        );
        return this.ok(res);
      }
      default:
        throw this.unsupported(src.type);
    }
  }

  async resolveTagsById(userId: string, id: string, params: ResolveTagsDto) {
    return this.resolveTags(await this.resolveById(userId, id), params);
  }

  /**
   * Existence check by NAME, independent of the tag-catalog pagination.
   *
   * Non-PI sources return exists:false rather than throwing — preset comparison
   * runs across every selected source, and one SQL source in the list must not
   * fail the whole check. Contrast tagsCurrentById, which throws 400: that one
   * is a direct user action on a single PI source.
   */
  private async resolveTags(src: ResolvedSource, params: ResolveTagsDto) {
    if (src.type !== 'aveva') {
      return this.ok({
        count: params.tagNames.length,
        found: 0,
        tags: params.tagNames.map((t) => ({ tagName: t, exists: false })),
      });
    }
    const res = await postToPython(
      '/v1/data-sources/pi/tags/resolve',
      {
        credentials: this.buildPiCredentials(src),
        tag_list: params.tagNames,
      },
      PYTHON_TIMEOUT.metadata,
    );
    return this.ok(res);
  }

  // ── credential mapping (row/config → connector contract) ────────────────────

  private buildPiCredentials(src: ResolvedSource) {
    return {
      api_server: src.host,
      pi_server: this.str(src.config, 'piServer') || src.dbName,
      user: src.username,
      password: src.secret,
    };
  }

  private buildSqlCredentials(src: ResolvedSource) {
    const driver = this.str(src.config, 'driver');
    const port = this.num(src.config, 'port');
    if (!driver) {
      throw new AppException({
        statusCode: 400,
        message: 'SQL source is missing a driver in its configuration.',
        type: 'ERROR',
      });
    }
    if (!port) {
      throw new AppException({
        statusCode: 400,
        message: 'SQL source is missing a port in its configuration.',
        type: 'ERROR',
      });
    }
    const schema = this.str(src.config, 'schema');
    return {
      driver,
      host: src.host,
      port,
      database: src.dbName,
      user: src.username,
      password: src.secret,
      ...(schema && { schema }),
    };
  }

  private buildRestCredentials(src: ResolvedSource) {
    const authType = this.str(src.config, 'authType') || 'none';
    const headers = this.record(src.config, 'headers');
    const credentials: Record<string, unknown> = {
      base_url: this.str(src.config, 'baseUrl') || src.host,
      endpoint: this.str(src.config, 'endpoint'),
      method: this.str(src.config, 'method') || 'GET',
      auth_type: authType,
      user: src.username,
      api_key_name: this.str(src.config, 'apiKeyName'),
      api_key_location: this.str(src.config, 'apiKeyLocation') || 'header',
      ...(headers && { headers }),
    };
    // The single stored secret fills the field the chosen auth scheme uses.
    if (authType === 'bearer') credentials.token = src.secret;
    else if (authType === 'api_key') credentials.api_key = src.secret;
    else credentials.password = src.secret; // basic (and harmless for none)
    return credentials;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private str(config: Record<string, unknown>, key: string): string {
    const v = config[key];
    return typeof v === 'string' ? v : '';
  }

  private num(config: Record<string, unknown>, key: string): number | null {
    const v = config[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    return null;
  }

  private record(
    config: Record<string, unknown>,
    key: string,
  ): Record<string, string> | null {
    const v = config[key];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
    }
    return Object.keys(out).length ? out : null;
  }

  private unsupported(type: string): AppException {
    return new AppException({
      statusCode: 400,
      message: `Live connection is not supported for '${type}' sources.`,
      type: 'ERROR',
    });
  }

  private ok(data: unknown) {
    return {
      statusCode: 200,
      message: 'OK',
      type: 'SUCCESS' as const,
      data,
    };
  }
}
