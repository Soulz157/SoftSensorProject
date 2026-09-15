import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  getRunManifest,
  readFeatureSpec,
} from '@/lib/python-preprocess-client';
import {
  resolveFeatureSources,
  type FeatureSpecEntry,
} from '@/lib/feature-sources';
import { DataSourceConnectService } from '@/api/v1/data-source/authorized/data-source.connect.service';

/**
 * MODEL-SERVE-001-T15. The Input Data tab's per-tag data-quality column —
 * PI's OWN Good/Questionable flag for this model's feature tags, read live.
 *
 * WHY A LIVE READ AND NOT A STORED ONE, stated plainly because the obvious
 * assumption is wrong: this system's `{tag}__status` is NOT PI's quality
 * flag. The historical/summary fetch every dataset and inference window
 * runs through (`aveva_connect.convertAverageDicttoDataFrame`) selects only
 * `.value.value`/`.value.timestamp` — PI's `good`/`questionable`/
 * `substituted` are never requested on that path, and `TagDataPoint` has no
 * field to carry them. `frame_service.from_pi_response` then derives
 * `__status` from `_coerce_value` ("is this a parseable finite number")
 * plus a per-tag fetch failure. That is parse/arrival health, not PI
 * quality, and it is what BRONZE, SILVER, GOLD and a scheduled window's
 * `input.parquet` all carry. PI's own flag reaches this system on exactly
 * one path — the snapshot read this service calls.
 *
 * DELIBERATELY SEPARATE FROM `/input-schema`: that endpoint is a static
 * schema read whose own discipline is "never a broken tab" (see its doc
 * comment). Folding a live PI call into it would make the entire feature
 * list fail whenever PI is unreachable. This one is best-effort by
 * construction — every failure path returns `unavailableReason` and an
 * empty feature list, never a throw, so the tab degrades to "status
 * unavailable" instead of breaking.
 */

/** PI's own quality vocabulary, mapped into this system's display terms.
 *  `UNKNOWN` means PI returned nothing for the tag (or was unreachable) —
 *  never "assume Good". */
export type PiTagStatus = 'Good' | 'Questionable' | 'Bad' | 'UNKNOWN';

export interface FeatureTagStatus {
  column: string;
  status: PiTagStatus;
  /** Present when the status is not a plain Good — says why, in the
   *  reader's terms rather than PI's raw booleans. */
  reason?: string;
  /** For a DERIVED feature: which of its base tags are not Good. Absent for
   *  a base tag (it is its own source) and for a healthy feature. This is
   *  the actionable half — at six source tags, "Bad" alone tells a reader
   *  nothing about which sensor to go look at. */
  failingSources?: string[];
  /** PI's current reading for a BASE tag, straight through — null for a
   *  derived feature, which PI has never heard of. */
  value?: number | string | null;
  timestamp?: string | null;
}

interface TagCurrentRow {
  tag_name: string;
  value?: number | string | null;
  timestamp?: string | null;
  isGood?: boolean | null;
  questionable?: boolean | null;
  substituted?: boolean | null;
}

@Injectable()
export class ModelInputStatusAuthorizedService {
  private readonly log = new Logger(ModelInputStatusAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connect: DataSourceConnectService,
  ) {}

  /** Same copy every other authorized Model read in this codebase carries —
   *  see `ModelInputSchemaAuthorizedService`'s own note on why no shared
   *  helper exists across modules. VIEWER is rejected, matching the sibling
   *  `/input-schema` this tab calls beside this one. */
  private async assertModelAccess(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return model;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return model;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: model.workspaceId, userId: user.id },
    });
    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  async getInputStatusService(modelId: string, user: Auth.UserPayload) {
    await this.assertModelAccess(modelId, user);

    const version =
      (await this.prisma.modelVersion.findFirst({
        where: { modelId, stage: 'PRODUCTION' },
        include: { sourceRun: { select: { manifestKey: true } } },
      })) ??
      (await this.prisma.modelVersion.findFirst({
        where: { modelId },
        orderBy: { version: 'desc' },
        include: { sourceRun: { select: { manifestKey: true } } },
      }));

    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no version yet.`,
        type: 'ERROR',
      });
    }

    const featureColumns = await this.resolveFeatureColumns(
      version.sourceRun.manifestKey,
    );
    if (!featureColumns) {
      return this.unavailable(
        "This model's training run did not record its feature columns.",
      );
    }

    const specFeatures = await this.readSpecFeatures(version.goldObjectKey);
    const { baseSourcesByColumn, unresolved } =
      resolveFeatureSources(specFeatures);

    const sourceId = await this.resolveSourceId(
      modelId,
      version.sourceDatasetId,
    );
    if (!sourceId) {
      return this.unavailable(
        'Could not resolve which data source to read live tag status from — ' +
          'this model has no inference schedule, and its dataset has no single source.',
      );
    }

    // Every BASE tag this model depends on: the feature columns that are not
    // themselves derived, plus the base sources behind the ones that are.
    const baseTags = new Set<string>();
    for (const column of featureColumns) {
      const sources = baseSourcesByColumn[column];
      if (sources) {
        for (const s of sources) baseTags.add(s);
      } else if (!unresolved.has(column)) {
        baseTags.add(column);
      }
    }

    if (baseTags.size === 0) {
      return this.unavailable(
        'No base PI tags could be resolved for this model’s feature columns.',
      );
    }

    let byTag: Map<string, TagCurrentRow>;
    try {
      byTag = await this.fetchCurrent(user.id, sourceId, [...baseTags]);
    } catch (err) {
      // PI unreachable, a non-PI source, or a source this user cannot read
      // (`resolveById` scopes by `createdById`). All three degrade this one
      // column rather than failing the tab.
      this.log.warn(
        `live tag status unavailable for model ${modelId} via source ${sourceId}: ${(err as Error).message}`,
      );
      return this.unavailable(
        `Could not read live tag status: ${(err as Error).message}`,
      );
    }

    const features: FeatureTagStatus[] = featureColumns.map((column) => {
      if (unresolved.has(column)) {
        return {
          column,
          status: 'UNKNOWN' as const,
          reason:
            'This feature’s recipe kind is not one this read knows how to ' +
            'trace back to source tags.',
        };
      }

      const sources = baseSourcesByColumn[column];
      // A base tag: its own PI reading decides it.
      if (!sources) return this.baseTagStatus(column, byTag.get(column));

      // A derived feature with no tag sources at all (a `datetime` part) is
      // always computable — no tag's quality can spoil it.
      if (sources.length === 0) {
        return {
          column,
          status: 'Good' as const,
          reason: 'Derived from the timestamp — reads no tag.',
        };
      }
      return this.derivedStatus(column, sources, byTag);
    });

    return {
      statusCode: 200,
      message: 'Live tag status fetched',
      type: 'SUCCESS' as const,
      data: {
        modelId,
        versionId: version.id,
        sourceId,
        features,
        unavailableReason: null,
      },
    };
  }

  // ── status derivation ───────────────────────────────────────────────────

  /** PI's booleans -> this system's display vocabulary. A tag PI did not
   *  return at all is UNKNOWN, never Good — the whole point of showing this
   *  column is that a missing answer is itself an answer. */
  private baseTagStatus(
    column: string,
    row: TagCurrentRow | undefined,
  ): FeatureTagStatus {
    if (!row || row.isGood === null || row.isGood === undefined) {
      return {
        column,
        status: 'UNKNOWN',
        reason: 'PI returned no current reading for this tag.',
        value: row?.value ?? null,
        timestamp: row?.timestamp ?? null,
      };
    }
    const base = {
      column,
      value: row.value ?? null,
      timestamp: row.timestamp ?? null,
    };
    if (row.isGood === false) {
      return { ...base, status: 'Bad', reason: 'PI reports this tag as Bad.' };
    }
    if (row.questionable === true) {
      return {
        ...base,
        status: 'Questionable',
        reason: 'PI flags this reading as Questionable.',
      };
    }
    return {
      ...base,
      status: 'Good',
      ...(row.substituted === true
        ? { reason: 'Good, but PI reports the value as substituted.' }
        : {}),
    };
  }

  /**
   * A derived feature is Bad the moment ANY required source is not Good —
   * mirroring `feature_service._compute_feature_column`'s own gate exactly
   * (`_good_value` returns None for any status other than STATUS_GOOD, and
   * the row is written `(0.0, STATUS_BAD)`). Questionable counts as not-Good
   * there, so it counts here too, and the offending sources are named.
   *
   * A source PI said nothing about leaves the verdict UNKNOWN rather than
   * Good — unless another source is already definitively not-Good, which is
   * sufficient on its own.
   */
  private derivedStatus(
    column: string,
    sources: string[],
    byTag: Map<string, TagCurrentRow>,
  ): FeatureTagStatus {
    const failing: string[] = [];
    let anyUnknown = false;

    for (const source of sources) {
      const status = this.baseTagStatus(source, byTag.get(source)).status;
      if (status === 'Bad' || status === 'Questionable') failing.push(source);
      else if (status === 'UNKNOWN') anyUnknown = true;
    }

    if (failing.length > 0) {
      const plural = failing.length === 1 ? '' : 's';
      const verb = failing.length === 1 ? 'is' : 'are';
      return {
        column,
        status: 'Bad',
        reason: `Not Good because its source tag${plural} ${failing.join(', ')} ${verb} not Good.`,
        failingSources: failing,
        value: null,
        timestamp: null,
      };
    }
    if (anyUnknown) {
      return {
        column,
        status: 'UNKNOWN',
        reason: 'PI returned no current reading for one or more source tags.',
        value: null,
        timestamp: null,
      };
    }
    return { column, status: 'Good', value: null, timestamp: null };
  }

  // ── resolution helpers ──────────────────────────────────────────────────

  /** `InferenceSchedule.sourceId` first — that is a deliberate, already
   *  validated choice, resolved against the pinned version's own
   *  `sourceDatasetId` (see its schema doc comment). Otherwise fall back to
   *  the dataset's single source, the same rule `putScheduleService` uses;
   *  more than one source with no schedule is genuinely ambiguous, and
   *  guessing would attribute another source's tag health to this model. */
  private async resolveSourceId(
    modelId: string,
    sourceDatasetId: string,
  ): Promise<string | null> {
    const schedule = await this.prisma.inferenceSchedule.findFirst({
      where: { modelId },
      select: { sourceId: true },
    });
    if (schedule?.sourceId) return schedule.sourceId;

    const dataset = await this.prisma.dataset.findUnique({
      where: { id: sourceDatasetId },
      select: { sourceIds: true },
    });
    if (dataset?.sourceIds.length === 1) return dataset.sourceIds[0];
    return null;
  }

  private async fetchCurrent(
    userId: string,
    sourceId: string,
    tagList: string[],
  ): Promise<Map<string, TagCurrentRow>> {
    const res = (await this.connect.tagsCurrentById(userId, sourceId, {
      tagList,
    })) as { data?: { tags?: TagCurrentRow[] } };
    const rows = res.data?.tags ?? [];
    return new Map(rows.map((r) => [r.tag_name, r]));
  }

  /** Best-effort, same discipline as the sibling schema read: a missing or
   *  unreadable manifest means "cannot say", never a thrown error. */
  private async resolveFeatureColumns(
    manifestKey: string | null,
  ): Promise<string[] | null> {
    if (!manifestKey) return null;
    try {
      const manifest = await getRunManifest(manifestKey);
      const columns = manifest?.feature_columns;
      return columns && columns.length > 0 ? columns : null;
    } catch {
      return null;
    }
  }

  /** `feature_spec.json`'s `features[]`, untouched — `resolveFeatureSources`
   *  owns interpreting the per-kind config shapes. An unreadable spec means
   *  every column is treated as a base tag, which is the correct fallback
   *  for a model whose features are all plain tags. */
  private async readSpecFeatures(
    goldObjectKey: string,
  ): Promise<FeatureSpecEntry[]> {
    try {
      const { spec } = await readFeatureSpec(goldObjectKey);
      return spec.features ?? [];
    } catch {
      return [];
    }
  }

  private unavailable(reason: string) {
    return {
      statusCode: 200,
      message: 'Live tag status unavailable',
      type: 'SUCCESS' as const,
      data: {
        features: [] as FeatureTagStatus[],
        unavailableReason: reason,
      },
    };
  }
}
