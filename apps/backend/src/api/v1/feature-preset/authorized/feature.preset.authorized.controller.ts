import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { FeaturePresetAuthorizedService } from './feature.preset.authorized.service';

/**
 * Feature-preset routes. Thin delegates — every rule lives in the service.
 *
 * The upload takes the raw `FastifyRequest` rather than `@UploadedFile()`:
 * this app runs the FastifyAdapter (main.ts), and `FileInterceptor` ships with
 * `@nestjs/platform-express`, so it never sees a request here. `req.file()`
 * from `@fastify/multipart` is the working path, as used by the workspace
 * thumbnail route.
 */
@ApiBearerAuth()
@ApiTags('Feature Preset')
@Controller('authorized/feature-preset')
@UseGuards(JwtAccessGuard)
export class FeaturePresetAuthorizedController {
  constructor(private readonly service: FeaturePresetAuthorizedService) {}

  @Post('/imports')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import a soft-sensor workbook into feature presets',
  })
  async importWorkbook(
    @Query('workspaceId') workspaceId: string,
    @Users() user: Auth.UserPayload,
    @Req() req: FastifyRequest,
  ) {
    return this.service.importWorkbook(workspaceId, user, req);
  }

  @Get('/')
  @ApiOperation({
    summary: 'List presets from the latest import (or a named one)',
  })
  async listPresets(
    @Query('workspaceId') workspaceId: string,
    @Users() user: Auth.UserPayload,
    @Query('importId') importId?: string,
  ) {
    return this.service.listPresets(workspaceId, user, importId);
  }

  @Get('/:id/document')
  @ApiOperation({ summary: 'Read one stored preset document' })
  async getPresetDocument(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getPresetDocument(id, user);
  }

  @Get('/imports/:id/sdta')
  @ApiOperation({
    summary: 'Read the SD&TA cut config for one import, if it has one',
  })
  async getSdtaDocument(
    @Param('id') id: string,
    @Users() user: Auth.UserPayload,
  ) {
    return this.service.getSdtaDocument(id, user);
  }

  @Delete('/imports/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an import and its presets' })
  async deleteImport(@Param('id') id: string, @Users() user: Auth.UserPayload) {
    return this.service.deleteImport(id, user);
  }
}
