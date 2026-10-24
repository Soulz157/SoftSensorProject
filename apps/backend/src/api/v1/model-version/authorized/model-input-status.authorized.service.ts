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
import { canReadWithGrant } from '@/lib/workspace-permission';
import { readLiveSourceOverride } from '@/lib/live-source-override';

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
/** DataSource types the inference scheduler can fetch a window from. */
export const SCHEDULABLE_SOURCE_TYPES: readonly string[] = ['aveva', 'sql'];

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
  private async assertModelAccess(
    modelId: string,
    user: Auth.UserPayload,
    // 'edit' (default) is every mutating route: OWNER/STAFF only.
    // 'monitoring-read' is a read a VIEWER may make once an OWNER granted
    // MONITORING_VIEW. Never pass it from a route that changes anything.
    access: 'edit' | 'monitoring-read' = 'edit',
  ) {
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
    const allowed =
      access === 'monitoring-read'
        ? canReadWithGrant(member, 'MONITORING_VIEW')
        : !!member && member.role !== 'VIEWER';
    if (!allowed) {
      throw new AppException({
        statusCode: 403,
        message:
          access === 'monitoring-read'
            ? 'Forbidden: monitoring access required'
            : 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  /**
   * MODEL-SERVE-001-T25. The enable-time preflight, expressed as a THIN READ
   * OF THIS SAME PROBE rather than a second one. T25 is explicit that a
   * second probe must not be written: this one already queries PI's snapshot
   * path (the only path carrying PI's own good/questionable/substituted
   * flag) and already resolves a derived feature's base tags transitively.
   *
   * Returns evidence, never a decision — `putScheduleService` owns the
   * refusal. `ok: null` means NOT PROBED, which is not a soft pass: it is the
   * honest answer for a non-PI source, because `tagsCurrentById` accepts PI
   * only and `intergrations/sql_connect.py` binds the time range as VARCHAR,
   * so a SQL probe would fail for a CONNECTOR defect rather than for the
   * operator's config. FLAGGED, NOT FIXED — that bug belongs to the
   * connector. Refusing every SQL-sourced schedule on its behalf would
   * manufacture false refusals for a whole source class.
   *
   * `sourceId` is passed IN rather than re-resolved, because at enable time
   * the caller's choice is the authoritative one: `resolveSourceId` reads the
   * EXISTING schedule row, which on a first enable does not exist yet and on
   * a source change still holds the old value. Probing one source and then
   * enabling another is exactly the silently-wrong-but-still-returns-an-
   * answer class this feature exists to close.
   */
  async preflightSourceService(
    modelId: string,
    user: Auth.UserPayload,
    sourceId: string,
    // MODEL-SERVE-037-T04. The binding being STARTED, not the stored one: a
    // live source override probes the PI tags its columns map to.
    columnTagMap?: Record<string, string>,
  ): Promise<{ ok: boolean | null; reason: string | null }> {
    const source = await this.prisma.dataSource.findUnique({
      where: { id: sourceId },
      select: { type: true },
    });
    if (!source) {
      return { ok: false, reason: `Data source ${sourceId} not found.` };
    }
    // MODEL-SERVE-037-T01. A source the scheduler cannot read at all (a CSV
    // upload) is a REFUSAL, not "not probed": started anyway, every window
    // would fail hourly with "unsupported type". Same list as
    // `InferenceWindowSchedulerService.resolveSource`.
    if (!SCHEDULABLE_SOURCE_TYPES.includes(source.type)) {
      return {
        ok: false,
        reason:
          `This model's data source is a "${source.type}" source, which ` +
          `scheduled inference cannot read (PI and SQL sources only). ` +
          `Set a live PI source with a column-to-tag mapping in Edit > ` +
          `Data Source, or retrain on a dataset from a PI or SQL source.`,
      };
    }
    // The same guard `tagsCurrentById` applies, read UP FRONT so a non-PI
    // source is recorded as not-probed rather than as a failure wearing the
    // connector's rejection text.
    if (source.type !== 'aveva') {
      return {
        ok: null,
        reason:
          `Not probed: live source checks are available for PI sources only ` +
          `(this source is "${source.type}").`,
      };
    }

    const map = columnTagMap ?? {};
    const res = await this.getInputStatusService(modelId, user, sourceId, map);
    const { features, unavailableReason } = res.data;

    // The connector's OWN TEXT, verbatim, straight through. V09 exists
    // because a guessed category sent a reader to audit a config that was
    // already correct.
    if (unavailableReason) return { ok: false, reason: unavailableReason };

    // MODEL-SERVE-038. An engineered column (`X__lag3`) with no recipe in the
    // version's feature_spec is not a PI tag, and the scheduled replay could
    // not rebuild it from PI either — every window would fail on a missing
    // column. Say which, rather than probing PI for names it never had.
    const unrecorded =
      'unrecordedColumns' in res.data ? res.data.unrecordedColumns : [];
    if (unrecorded.length > 0) {
      const shown = unrecorded.slice(0, 5).join(', ');
      const more =
        unrecorded.length > 5 ? ` and ${unrecorded.length - 5} more` : '';
      return {
        ok: false,
        reason:
          `${unrecorded.length} feature column(s) are neither a base tag of ` +
          `this model's dataset nor recorded in its feature spec (${shown}${more}), ` +
          'so scheduled inference could not rebuild them from PI. Re-save the ' +
          'dataset so its feature spec records them, then retrain.',
      };
    }

    // PI answered, but for nothing this model reads. Every window would fetch
    // an empty frame and fail hourly — the same 70-FAILED-window outcome as
    // an unreachable host, reached by a different route. T27 delegates
    // structural tag-missing to this task by name.
    const readable = features.filter((f) => f.status !== 'UNKNOWN');
    if (features.length > 0 && readable.length === 0) {
      return {
        ok: false,
        reason:
          'PI is reachable but returned no current reading for any of this ' +
          `model's ${features.length} feature column(s): ` +
          `${features.map((f) => f.column).join(', ')}.`,
      };
    }

    // MODEL-SERVE-037-T04 (user decision 2026-10-21). Under a live source
    // override every mapped tag must answer: a tag PI has never heard of is
    // a mapping mistake, and the Deploy table blocks it too — this keeps a
    // direct API call from skipping that rule. Dataset-derived bindings keep
    // the any-tag-readable rule above.
    const unread = 'unreadBaseTags' in res.data ? res.data.unreadBaseTags : [];
    if (Object.keys(map).length > 0 && unread.length > 0) {
      return {
        ok: false,
        reason:
          'PI returned no current reading for these mapped tags: ' +
          unread.map((c) => `${c} → ${map[c] ?? c}`).join(', ') +
          '. Check the column-to-tag mapping.',
      };
    }

    return { ok: true, reason: null };
  }

  async getInputStatusService(
    modelId: string,
    user: Auth.UserPayload,
    sourceIdOverride?: string,
    // Only read with `sourceIdOverride`; otherwise the stored schedule's
    // own map (if any) applies, so both answers come from one binding.
    columnTagMapOverride?: Record<string, string>,
  ) {
    await this.assertModelAccess(modelId, user, 'monitoring-read');

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

    const inputs = await this.resolveInputs(
      version.sourceRun.manifestKey,
      version.goldObjectKey,
      await this.datasetBaseTags(version.sourceDatasetId),
    );
    if ('reason' in inputs) return this.unavailable(inputs.reason);
    const {
      featureColumns,
      baseSourcesByColumn,
      unresolved,
      unrecorded,
      baseTags,
    } = inputs;

    const binding = sourceIdOverride
      ? { sourceId: sourceIdOverride, columnTagMap: columnTagMapOverride ?? {} }
      : await this.resolveBinding(modelId, version.sourceDatasetId);
    if (!binding) {
      return this.unavailable(
        'Could not resolve which data source to read live tag status from — ' +
          'this model has no inference schedule, and its dataset has no single source.',
      );
    }
    const { sourceId, columnTagMap } = binding;

    let byTag: Map<string, TagCurrentRow>;
    try {
      // MODEL-SERVE-037-T04. Under a live source override PI is asked for
      // the MAPPED tag, and the answer is filed back under the training
      // column so everything below reads column names as before.
      const piTag = (column: string) => columnTagMap[column] ?? column;
      const byPiTag = await this.fetchCurrent(
        user.id,
        sourceId,
        baseTags.map(piTag),
      );
      byTag = new Map();
      for (const column of baseTags) {
        const row = byPiTag.get(piTag(column));
        if (row) byTag.set(column, row);
      }
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
      if (unrecorded.has(column)) {
        return {
          column,
          status: 'UNKNOWN' as const,
          reason:
            'Not a base tag of the dataset and not recorded in the feature ' +
            'spec — not read from PI.',
        };
      }
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
        // Base columns PI returned nothing for (by training name).
        unreadBaseTags: baseTags.filter((t) => !byTag.has(t)),
        // MODEL-SERVE-038. Feature columns never sent to PI (see resolveInputs).
        unrecordedColumns: featureColumns.filter((c) => unrecorded.has(c)),
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
  private async resolveBinding(
    modelId: string,
    sourceDatasetId: string,
  ): Promise<{
    sourceId: string;
    columnTagMap: Record<string, string>;
  } | null> {
    const schedule = await this.prisma.inferenceSchedule.findFirst({
      where: { modelId },
      select: { sourceId: true, fetchConfig: true },
    });
    if (schedule?.sourceId) {
      return {
        sourceId: schedule.sourceId,
        columnTagMap:
          readLiveSourceOverride(schedule.fetchConfig)?.columnTagMap ?? {},
      };
    }

    const dataset = await this.prisma.dataset.findUnique({
      where: { id: sourceDatasetId },
      select: { sourceIds: true },
    });
    if (dataset?.sourceIds.length === 1) {
      return { sourceId: dataset.sourceIds[0], columnTagMap: {} };
    }
    return null;
  }

  /**
   * MODEL-SERVE-037-T02. The columns a live source override must map, off
   * the PRODUCTION version — the same version `putScheduleService` binds.
   * Throws: this answers a write, where "cannot say" must refuse.
   */
  async resolveOverrideColumnsService(
    modelId: string,
  ): Promise<{ baseTags: string[]; targetY: string | null }> {
    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      include: { sourceRun: { select: { manifestKey: true, targetY: true } } },
    });
    if (!version) {
      throw new AppException({
        statusCode: 422,
        message: `Model ${modelId} has no PRODUCTION version.`,
        type: 'ERROR',
      });
    }
    const inputs = await this.resolveInputs(
      version.sourceRun.manifestKey,
      version.goldObjectKey,
    );
    if ('reason' in inputs) {
      throw new AppException({
        statusCode: 422,
        message: inputs.reason,
        type: 'ERROR',
      });
    }
    return {
      baseTags: inputs.baseTags,
      targetY: version.sourceRun.targetY ?? null,
    };
  }

  /**
   * Every BASE tag this model depends on: the feature columns that are not
   * themselves derived, plus the base sources behind the ones that are. One
   * derivation for the live status read and the override's coverage check,
   * so the two can never disagree about what must be mapped.
   */
  private async resolveInputs(
    manifestKey: string | null,
    goldObjectKey: string,
    /**
     * MODEL-SERVE-038. The dataset's own `pipelineConfig.baseTags` — what the
     * scheduler actually fetches. When given (non-empty), a feature column
     * with no spec recipe is a base tag ONLY if it is one of these; anything
     * else (an engineered `X__lag3` whose recipe the spec lost) is
     * `unrecorded` and never sent to PI. Omitted: the old rule — every
     * recipe-less column is assumed to be a base tag.
     */
    knownBaseTags?: ReadonlySet<string>,
  ): Promise<
    | {
        featureColumns: string[];
        baseSourcesByColumn: Record<string, string[]>;
        unresolved: Set<string>;
        unrecorded: Set<string>;
        baseTags: string[];
      }
    | { reason: string }
  > {
    const featureColumns = await this.resolveFeatureColumns(manifestKey);
    if (!featureColumns) {
      return {
        reason: "This model's training run did not record its feature columns.",
      };
    }

    const specFeatures = await this.readSpecFeatures(goldObjectKey);
    const { baseSourcesByColumn, unresolved } =
      resolveFeatureSources(specFeatures);

    const checkBase = knownBaseTags !== undefined && knownBaseTags.size > 0;
    const baseTags = new Set<string>();
    const unrecorded = new Set<string>();
    for (const column of featureColumns) {
      const sources = baseSourcesByColumn[column];
      if (sources) {
        for (const s of sources) baseTags.add(s);
      } else if (unresolved.has(column)) {
        continue;
      } else if (checkBase && !knownBaseTags.has(column)) {
        unrecorded.add(column);
      } else {
        baseTags.add(column);
      }
    }
    if (baseTags.size === 0) {
      return {
        reason:
          'No base PI tags could be resolved for this model’s feature columns.',
      };
    }
    return {
      featureColumns,
      baseSourcesByColumn,
      unresolved,
      unrecorded,
      baseTags: [...baseTags],
    };
  }

  /** MODEL-SERVE-038. The dataset's recorded base tags (what the scheduler
   *  fetches), or undefined when there is no dataset or none are recorded. */
  private async datasetBaseTags(
    datasetId: string | null,
  ): Promise<Set<string> | undefined> {
    if (!datasetId) return undefined;
    const dataset = await this.prisma.dataset.findUnique({
      where: { id: datasetId },
      select: { pipelineConfig: true },
    });
    const raw = (dataset?.pipelineConfig as { baseTags?: unknown } | null)
      ?.baseTags;
    if (!Array.isArray(raw)) return undefined;
    const tags = raw.filter((t): t is string => typeof t === 'string');
    return tags.length > 0 ? new Set(tags) : undefined;
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
