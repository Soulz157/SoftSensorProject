import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  postMultipartToPython,
  postToPython,
  PYTHON_TIMEOUT,
} from '@/lib/python-client';
import { presetImportPrefix } from '@/lib/artifact-keys';
import {
  PythonImportResponseSchema,
  PythonPresetDocumentSchema,
  PythonSdtaDocumentSchema,
} from './dto/feature.preset.authorized.dto';

/**
 * Soft-sensor feature presets imported from an engineering workbook.
 *
 * Division of labour, same as dataset versions: this service owns
 * authorization, the object-key layout and the Postgres index; the Python
 * connector owns the parsing and holds the only S3 credentials. The workbook
 * bytes pass through here once on their way upstream and are never stored
 * locally — which is also why reading a preset back has to go through the
 * connector rather than straight to storage.
 *
 * Access is owner-or-member on the workspace, matching
 * `dataset-version.authorized.service.ts`. Presets are workspace assets: a
 * teammate who imported the plant template must not be the only person who can
 * use it.
 */
@Injectable()
export class FeaturePresetAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Extensions the connector can actually open. */
  private static readonly ALLOWED_EXTENSIONS = ['.xlsx', '.xlsm'];

  // ── access ───────────────────────────────────────────────────────────────

  /**
   * Owner-or-member on the workspace. 404 rather than 403: confirming to an
   * unauthorised caller that a workspace exists is itself a leak. ADMIN
   * bypasses membership, matching assertDatasetAccess.
   */
  private async assertWorkspaceAccess(
    workspaceId: string,
    user: Auth.UserPayload,
  ) {
    const isAdmin = user.role === 'ADMIN';
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        deletedAt: null,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { ownerId: user.id },
                { members: { some: { userId: user.id } } },
              ],
            }),
      },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
    return workspace;
  }

  // ── import ───────────────────────────────────────────────────────────────

  /**
   * Parse an uploaded workbook into presets and index what comes back.
   *
   * The import id is minted HERE, before the upload, because it is half the
   * object prefix: the connector only ever appends a filename to what it is
   * given, so the key layout stays owned by one side. A re-upload therefore
   * writes a fresh prefix instead of overwriting the previous import.
   */
  async importWorkbook(
    workspaceId: string,
    user: Auth.UserPayload,
    req: FastifyRequest,
  ) {
    await this.assertWorkspaceAccess(workspaceId, user);

    const upload = await req.file();
    if (!upload) {
      throw new AppException({
        statusCode: 400,
        message: 'No file uploaded',
        type: 'ERROR',
      });
    }

    const fileName = upload.filename || 'workbook.xlsx';
    const allowed = FeaturePresetAuthorizedService.ALLOWED_EXTENSIONS;
    if (!allowed.some((ext) => fileName.toLowerCase().endsWith(ext))) {
      throw new AppException({
        statusCode: 400,
        message: 'Upload an Excel workbook (.xlsx or .xlsm)',
        type: 'ERROR',
      });
    }

    // Reading the whole part is what enforces the 5 MB cap registered in
    // main.ts: @fastify/multipart raises here if the stream exceeds it.
    const buffer = await upload.toBuffer();

    const importId = randomUUID();
    const prefix = presetImportPrefix(workspaceId, importId);

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)]), fileName);
    form.append('key_prefix', prefix);

    const raw = await postMultipartToPython<unknown>(
      '/v1/presets/import',
      form,
      PYTHON_TIMEOUT.metadata,
    );
    // Parsed, not cast: this goes straight into two tables, so a changed shape
    // upstream must fail the request rather than land as null columns.
    const parsed = PythonImportResponseSchema.parse(raw);

    const created = await this.prisma.$transaction(async (tx) => {
      const record = await tx.featurePresetImport.create({
        data: {
          id: importId,
          workspaceId,
          createdById: user.id,
          fileName: parsed.file_name,
          objectPrefix: parsed.key_prefix,
          sheetCount: parsed.sheet_count,
          presetCount: parsed.presets.length,
          skippedSheets: parsed.skipped_sheets,
          sdtaKey: parsed.sdta?.object_key ?? null,
        },
      });

      await tx.featurePreset.createMany({
        data: parsed.presets.map((preset) => ({
          importId: record.id,
          workspaceId,
          presetId: preset.preset_id,
          unit: preset.unit,
          configNo: preset.config_no,
          name: preset.name,
          samplingPoint: preset.sampling_point || null,
          targetY: preset.target_y,
          objectKey: preset.object_key,
          equationCount: preset.equation_count,
          rawTagCount: preset.raw_tag_count,
          requiredBaseTags: preset.required_base_tags,
          incomplete: preset.incomplete,
        })),
      });

      return record;
    });

    return {
      statusCode: 201,
      message: `Imported ${parsed.presets.length} preset(s) from ${parsed.file_name}`,
      type: 'SUCCESS' as const,
      data: {
        importId: created.id,
        fileName: created.fileName,
        objectPrefix: created.objectPrefix,
        sheetCount: created.sheetCount,
        unitCount: parsed.unit_count,
        presetCount: created.presetCount,
        skippedSheets: created.skippedSheets,
        sdta: parsed.sdta ?? null,
        importedAt: parsed.imported_at,
      },
    };
  }

  // ── read ─────────────────────────────────────────────────────────────────

  /**
   * Presets from ONE import — the newest for the workspace unless `importId`
   * names an older one.
   *
   * Returning every import's rows would fill the picker with duplicates: the
   * same unit and config legitimately reappear in every re-upload, and only the
   * latest copy points at the objects a user means to apply.
   */
  async listPresets(
    workspaceId: string,
    user: Auth.UserPayload,
    importId?: string,
  ) {
    await this.assertWorkspaceAccess(workspaceId, user);

    const record = await this.prisma.featurePresetImport.findFirst({
      where: { workspaceId, ...(importId ? { id: importId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        presets: { orderBy: [{ unit: 'asc' }, { configNo: 'asc' }] },
      },
    });

    return {
      statusCode: 200,
      message: 'Feature presets retrieved successfully',
      type: 'SUCCESS' as const,
      data: {
        import: record
          ? {
              id: record.id,
              fileName: record.fileName,
              sheetCount: record.sheetCount,
              skippedSheets: record.skippedSheets,
              sdtaKey: record.sdtaKey,
              createdAt: record.createdAt,
            }
          : null,
        presets: record?.presets ?? [],
      },
    };
  }

  /**
   * The full stored document: target, features, equations, required tags.
   *
   * Proxied through the connector because NestJS deliberately holds no S3
   * credentials — it can say where an object lives but cannot read it.
   */
  async getPresetDocument(id: string, user: Auth.UserPayload) {
    const preset = await this.prisma.featurePreset.findUnique({
      where: { id },
    });
    if (!preset) {
      throw new AppException({
        statusCode: 404,
        message: 'Feature preset not found',
        type: 'ERROR',
      });
    }
    await this.assertWorkspaceAccess(preset.workspaceId, user);

    const raw = await postToPython<unknown>(
      '/v1/presets/document',
      { key: preset.objectKey },
      PYTHON_TIMEOUT.metadata,
    );

    return {
      statusCode: 200,
      message: 'Feature preset document retrieved successfully',
      type: 'SUCCESS' as const,
      data: PythonPresetDocumentSchema.parse(raw),
    };
  }

  /**
   * The shutdown/turnaround cut config, if the workbook had one.
   *
   * Keyed off the IMPORT, not a preset — SD&TA is not scoped to one unit
   * sheet, so it has no `FeaturePreset` row to hang a lookup off. A 404 for
   * "no config" and a 404 for "no such import" both come from the same
   * not-found branch below; that is deliberate, not a shortcut — either way
   * there is nothing to read, and it is not this route's job to distinguish
   * "you gave a bad id" from "this import simply had no SD&TA sheet".
   */
  async getSdtaDocument(importId: string, user: Auth.UserPayload) {
    const record = await this.prisma.featurePresetImport.findUnique({
      where: { id: importId },
    });
    if (!record) {
      throw new AppException({
        statusCode: 404,
        message: 'Feature preset import not found',
        type: 'ERROR',
      });
    }
    await this.assertWorkspaceAccess(record.workspaceId, user);

    if (!record.sdtaKey) {
      throw new AppException({
        statusCode: 404,
        message: 'This import has no SD&TA cut config',
        type: 'ERROR',
      });
    }

    const raw = await postToPython<unknown>(
      '/v1/presets/sdta-document',
      { key: record.sdtaKey },
      PYTHON_TIMEOUT.metadata,
    );

    return {
      statusCode: 200,
      message: 'SD&TA cut config retrieved successfully',
      type: 'SUCCESS' as const,
      data: PythonSdtaDocumentSchema.parse(raw),
    };
  }

  // ── delete ───────────────────────────────────────────────────────────────

  /**
   * Drop an import and its presets. The FK cascade removes the preset rows.
   *
   * The stored documents are NOT deleted: this service has no S3 credentials,
   * and the connector's cleanup endpoint deliberately refuses prefixes outside
   * `tmp/`. The objects are left orphaned but unreferenced, which is the safer
   * of the two failure modes — a row pointing at a deleted object would render
   * as a preset that breaks on apply.
   */
  async deleteImport(id: string, user: Auth.UserPayload) {
    const record = await this.prisma.featurePresetImport.findUnique({
      where: { id },
    });
    if (!record) {
      throw new AppException({
        statusCode: 404,
        message: 'Feature preset import not found',
        type: 'ERROR',
      });
    }
    await this.assertWorkspaceAccess(record.workspaceId, user);

    await this.prisma.featurePresetImport.delete({ where: { id } });

    return {
      statusCode: 200,
      message: 'Feature preset import deleted successfully',
      type: 'SUCCESS' as const,
    };
  }
}
