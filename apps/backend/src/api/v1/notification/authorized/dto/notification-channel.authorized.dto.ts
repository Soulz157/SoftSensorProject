import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { NOTIFICATION_EVENT_KINDS } from '@/lib/notification-events';

const eventKind = z.enum(NOTIFICATION_EVENT_KINDS);

/**
 * MODEL-SERVE-022-T04. `target`/`recipientUserIds` are cross-checked in the
 * SERVICE, not here (D-user-decision: recipients must be real workspace
 * members, which this schema cannot see) — same split
 * `PutInferenceScheduleSchema` already draws for its own service-side
 * checks.
 */
export const CreateNotificationChannelSchema = z
  .object({
    kind: z.enum(['TEAMS_WORKFLOW', 'EMAIL']),
    name: z.string().trim().min(1).max(120),
    /** TEAMS_WORKFLOW only: the Workflows URL, plaintext over the wire once
     *  (HTTPS request), encrypted at rest immediately (encryptSecret). */
    target: z.string().trim().url().optional(),
    /** EMAIL only: workspace member user ids. */
    recipientUserIds: z.array(z.string().trim().min(1)).optional(),
    enabled: z.boolean().optional(),
    minSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
    events: z.array(eventKind).optional(),
    cooldownMinutes: z.number().int().nonnegative().max(1440).optional(),
    /** Models this channel notifies for — an explicit allow-list; at least
     *  one. Required on create, optional on update (but never emptied). */
    focusModelIds: z.array(z.string().trim().min(1)).min(1, {
      message: 'Select at least one model for this channel.',
    }),
  })
  .strict()
  .refine((dto) => dto.kind !== 'TEAMS_WORKFLOW' || !!dto.target, {
    message: 'target (the Teams Workflow URL) is required for TEAMS_WORKFLOW.',
  })
  .refine(
    (dto) =>
      dto.kind !== 'EMAIL' ||
      (dto.recipientUserIds && dto.recipientUserIds.length > 0),
    { message: 'recipientUserIds is required and non-empty for EMAIL.' },
  )
  .refine(
    (dto) =>
      dto.kind !== 'TEAMS_WORKFLOW' || dto.target!.startsWith('https://'),
    {
      message: 'target must be an https:// URL.',
    },
  );

export class CreateNotificationChannelDto extends createZodDto(
  CreateNotificationChannelSchema,
) {}

/** A partial update — same fields, all optional, no cross-field refine:
 *  the SERVICE re-checks kind-specific requirements against the row's own
 *  MERGED state, the same discipline `putScheduleService` uses for
 *  warnSd/criticalSd. */
export const UpdateNotificationChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    target: z.string().trim().url().optional(),
    recipientUserIds: z.array(z.string().trim().min(1)).optional(),
    enabled: z.boolean().optional(),
    minSeverity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
    events: z.array(eventKind).optional(),
    cooldownMinutes: z.number().int().nonnegative().max(1440).optional(),
    focusModelIds: z
      .array(z.string().trim().min(1))
      .min(1, { message: 'Select at least one model for this channel.' })
      .optional(),
  })
  .strict();

export class UpdateNotificationChannelDto extends createZodDto(
  UpdateNotificationChannelSchema,
) {}
