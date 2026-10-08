import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body for POST /notifications/read. `upTo` is optional — omitted means
 *  "now"; when present it must be a real ISO datetime, never a bare date,
 *  so the watermark comparison in the service is unambiguous. */
export const MarkNotificationsReadSchema = z
  .object({
    upTo: z.string().datetime().optional(),
  })
  .strict();

export class MarkNotificationsReadDto extends createZodDto(
  MarkNotificationsReadSchema,
) {}

export const MuteModelSchema = z
  .object({
    modelId: z.string().trim().min(1),
  })
  .strict();

export class MuteModelDto extends createZodDto(MuteModelSchema) {}

/** Body for POST /notifications/clear — same shape as mark-read: `upTo` is
 *  the newest event the user was shown (omitted = now). */
export const ClearNotificationsSchema = MarkNotificationsReadSchema;

export class ClearNotificationsDto extends createZodDto(
  ClearNotificationsSchema,
) {}
