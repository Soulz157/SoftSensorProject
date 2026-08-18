import { PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { decryptSecret } from '@/lib/crypto';

/**
 * Map a stored DataSource onto the connector's credential contract.
 *
 * Extracted out of `dataset-version.authorized.service.ts` (DS-LAKE-005) so
 * the draft-scoped materialize path can build the same block without
 * duplicating the decrypt-and-shape logic — CLAUDE.md §3 forbids the same
 * business rule living in two services that would drift apart.
 *
 * The secret is decrypted here and lives only for the duration of the call —
 * the same handling as `data-source.connect.service.ts`. It is never returned
 * to the browser and never logged. Callers on both the dataset and the draft
 * path accept no credential fields from the browser at all; that is what
 * makes decrypting here, instead of trusting the request body, load-bearing.
 */
export function buildSourceBlock(
  source: {
    type: string;
    host: string;
    username: string;
    dbName: string;
    secretCiphertext: string;
    config: PrismaTypes.JsonValue;
  },
  dto: {
    tags: string[];
    startTime: string;
    endTime: string;
    summaryDuration?: string;
    timestampColumn?: string;
    table?: string;
  },
) {
  const secret = decryptSecret(source.secretCiphertext);

  if (source.type === 'aveva') {
    return {
      pi: {
        credentials: {
          api_server: source.host,
          pi_server: source.dbName,
          user: source.username,
          password: secret,
        },
        tag_list: dto.tags,
        start_time: dto.startTime,
        end_time: dto.endTime,
        ...(dto.summaryDuration && { summary_duration: dto.summaryDuration }),
      },
    };
  }

  if (source.type === 'sql') {
    if (!dto.timestampColumn || !dto.table) {
      throw new AppException({
        statusCode: 400,
        message:
          'A SQL source needs `table` and `timestampColumn` — the canonical ' +
          'frame is built around a declared time axis.',
        type: 'ERROR',
      });
    }
    // Per schema.prisma, `config` holds the non-secret {port, driver} for
    // SQL sources.
    const config = (source.config ?? {}) as {
      port?: number;
      driver?: string;
    };
    return {
      sql: {
        query: {
          credentials: {
            driver: config.driver ?? 'postgres',
            host: source.host,
            port: config.port ?? 5432,
            database: source.dbName,
            user: source.username,
            password: secret,
          },
          table: dto.table,
          time_column: dto.timestampColumn,
          start_time: dto.startTime,
          end_time: dto.endTime,
        },
        timestamp_column: dto.timestampColumn,
        tags: dto.tags,
      },
    };
  }

  throw new AppException({
    statusCode: 400,
    message: `Source type '${source.type}' cannot be materialized yet.`,
    type: 'ERROR',
  });
}
