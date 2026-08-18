import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const PythonPresetSummarySchema = z.object({
  preset_id: z.string(),
  unit: z.string(),
  config_no: z.number().int(),
  name: z.string(),
  sampling_point: z.string().default(''),
  target_y: z.string(),
  object_key: z.string(),
  equation_count: z.number().int().default(0),
  raw_tag_count: z.number().int().default(0),
  required_base_tags: z.array(z.string()).default([]),
  incomplete: z.boolean().default(false),
});

export const PythonSdtaSummarySchema = z.object({
  object_key: z.string(),
  range_count: z.number().int().default(0),
  condition_count: z.number().int().default(0),
});

export const PythonImportResponseSchema = z.object({
  file_name: z.string(),
  key_prefix: z.string(),
  imported_at: z.string(),
  sheet_count: z.number().int().default(0),
  unit_count: z.number().int().default(0),
  presets: z.array(PythonPresetSummarySchema),
  skipped_sheets: z.array(z.string()).default([]),
  sdta: PythonSdtaSummarySchema.nullish(),
});

export type PythonImportResponse = z.infer<typeof PythonImportResponseSchema>;

export const PythonPresetDocumentSchema = z.looseObject({
  schema_version: z.number().int(),
  preset_id: z.string(),
  unit: z.string(),
  config_no: z.number().int(),
  target_y: z.string(),
  features: z.array(z.record(z.string(), z.unknown())),
  required_base_tags: z.array(z.string()),
});

export class PythonPresetSummaryDto extends createZodDto(
  PythonPresetSummarySchema,
) {}
export class PythonImportResponseDto extends createZodDto(
  PythonImportResponseSchema,
) {}
export class PythonPresetDocumentDto extends createZodDto(
  PythonPresetDocumentSchema,
) {}

/**
 * The stored SD&TA cut config, from `/v1/presets/sdta-document`.
 *
 * A SEPARATE schema from `PythonPresetDocumentSchema`: that document has no
 * `preset_id`/`unit`/`target_y`/`features`, and parsing it against the preset
 * schema would fail every field that schema requires.
 */
export const PythonSdtaRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
});
export const PythonSdtaConditionSchema = z.object({
  tag: z.string(),
  op: z.string(),
  value: z.number(),
});
export const PythonSdtaDocumentSchema = z.object({
  schema_version: z.number().int(),
  ranges: z.array(PythonSdtaRangeSchema),
  conditions: z.array(PythonSdtaConditionSchema),
  source: z.object({
    file_name: z.string(),
    imported_at: z.string(),
  }),
});

export type PythonSdtaDocument = z.infer<typeof PythonSdtaDocumentSchema>;

export class PythonSdtaDocumentDto extends createZodDto(
  PythonSdtaDocumentSchema,
) {}
