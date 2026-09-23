import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { DatasetAuthorizedService } from './dataset.authorized.service';
import {
  CreateDatasetDto,
  UpdateDatasetDto,
} from './dto/dataset.authorized.dto';

@ApiBearerAuth()
@ApiTags('Dataset')
@Controller('authorized/dataset')
@UseGuards(JwtAccessGuard)
export class DatasetAuthorizedController {
  constructor(private readonly service: DatasetAuthorizedService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List datasets for the current user (by workspace)',
  })
  async listDatasetController(
    @Users() user: Auth.UserPayload,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.service.listDatasetService(user.id, workspaceId);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a dataset by id' })
  async getDatasetController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.getDatasetService(user.id, id);
  }

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new dataset' })
  async createDatasetController(
    @Users() user: Auth.UserPayload,
    @Body() body: CreateDatasetDto,
  ) {
    return this.service.createDatasetService(user, body);
  }

  @Patch('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an existing dataset' })
  async updateDatasetController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: UpdateDatasetDto,
  ) {
    return this.service.updateDatasetService(user, id, body);
  }

  // DS-LAKE-030-T01. Read BEFORE the delete, by the confirm dialog. A GET
  // rather than a field on the delete response, for the obvious reason: the
  // point is to show the list while the delete can still be called off.
  @Get('/:id/dependents')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Models that depend on this dataset (does not block deletion)',
  })
  async listDatasetDependentsController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.listDatasetDependentsService(user, id);
  }

  @Delete('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a dataset' })
  async deleteDatasetController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.deleteDatasetService(user, id);
  }
}
