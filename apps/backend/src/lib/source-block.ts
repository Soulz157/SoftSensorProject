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
/**
 * MODEL-SERVE-032. THE one place a stored PI DataSource becomes the
 * connector's credential contract. Three call sites used to build this by
 * hand and had already disagreed: the connect service and the scheduler used
 * `config.piServer || dbName`, this file used `dbName` alone -- so a source
 * with a `piServer` override read one server on the dataset path and another
 * on the monitoring path. A write-back would have been a fourth copy aimed at
 * the one server whose choice matters most.
 *
 * `secret` is the already-decrypted password; callers decrypt it (they differ
 * on how: per-user ownership check vs. background tick) and it never leaves
 * the NestJS -> python hop.
 */
export function buildPiCredentials(
  source: {
    host: string;
    username: string;
    dbName: string;
    config: PrismaTypes.JsonValue | Record<string, unknown> | null;
  },
  secret: string,
) {
  const config = (source.config ?? {}) as Record<string, unknown>;
  const piServer =
    typeof config.piServer === 'string' && config.piServer
      ? config.piServer
      : source.dbName;
  return {
    api_server: source.host,
    pi_server: piServer,
    user: source.username,
    password: secret,
  };
}

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
    calBasis?: string;
    summaryType?: string[];
    batchSize?: number;
    timestampColumn?: string;
    table?: string;
  },
) {
  const secret = decryptSecret(source.secretCiphertext);

  if (source.type === 'aveva') {
    return {
      pi: {
        credentials: buildPiCredentials(source, secret),
        tag_list: dto.tags,
        start_time: dto.startTime,
        end_time: dto.endTime,
        ...(dto.summaryDuration && { summary_duration: dto.summaryDuration }),
        ...(dto.calBasis && { cal_basis: dto.calBasis }),
        ...(dto.summaryType && { summary_type: dto.summaryType }),
        ...(dto.batchSize && { batch_size: dto.batchSize }),
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
