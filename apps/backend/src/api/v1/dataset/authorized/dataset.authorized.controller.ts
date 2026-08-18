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
