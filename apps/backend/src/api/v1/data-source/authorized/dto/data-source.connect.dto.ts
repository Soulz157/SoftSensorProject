import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

/**
 * DTOs for the Data Source *connect* endpoints (test / metadata / fetch).
 * These drive live calls to the FastAPI connectors via python-client.ts.
 *
 * The CRUD DTOs live in data-source.authorized.dto.ts — these are separate
 * because they carry per-call operation params, not persistence fields.
 */

/**
 * Ad-hoc source: full connection details supplied inline so the dialog can
 * "Test Connection" before the source is ever saved. `password` here is the
 * plaintext secret from the user — used for this one call, never persisted.
 */
export const AdHocSourceSchema = z.object({
  type: z.enum(['aveva', 'sql', 'csv', 'api']),
  host: z.string().default(''),
  username: z.string().default(''),
  password: z.string().default(''),
  dbName: z.string().default(''),
  config: z.record(z.string(), z.unknown()).optional(),
});

/** Metadata op params. `table` → SQL columns; omitted → SQL tables / PI tags. */
export const MetadataParamsSchema = z.object({
  table: z.string().optional(),
  nameFilter: z.string().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(5000).optional(),
});

/** Fetch op params — superset across PI / SQL / REST; the service picks the
 * subset each connector needs based on the source type. */
export const FetchParamsSchema = z.object({
  // PI
  tagList: z.array(z.string()).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  calBasis: z.string().optional(),
  summaryType: z.array(z.string()).optional(),
  summaryDuration: z.string().optional(),
  batchSize: z.number().int().min(1).max(1000).optional(),
  // SQL
  table: z.string().optional(),
  columns: z.array(z.string()).optional(),
  timeColumn: z.string().optional(),
  limit: z.number().int().min(1).max(50000).optional(),
  // REST
  jsonPath: z.string().optional(),
});

/** Current-value request for selected PI tags (metadata/snapshot, no archive). */
export const TagsCurrentSchema = z.object({
  tagList: z.array(z.string()).min(1),
  batchSize: z.number().int().min(1).max(1000).optional(),
});

export const ResolveTagsSchema = z.object({
  tagNames: z.array(z.string()).min(1),
});

export class AdHocSourceDto extends createZodDto(AdHocSourceSchema) {}
export class MetadataParamsDto extends createZodDto(MetadataParamsSchema) {}
export class FetchParamsDto extends createZodDto(FetchParamsSchema) {}
export class TagsCurrentDto extends createZodDto(TagsCurrentSchema) {}
export class ResolveTagsDto extends createZodDto(ResolveTagsSchema) {}
