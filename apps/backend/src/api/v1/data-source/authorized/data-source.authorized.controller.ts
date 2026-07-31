import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '@/guards/jwt-access.guard';
import { Users } from '@/common/decorators/user.decorator';
import { DataSourceAuthorizedService } from './data-source.authorized.service';
import { DataSourceConnectService } from './data-source.connect.service';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.authorized.dto';
import {
  AdHocSourceDto,
  FetchParamsDto,
  MetadataParamsDto,
  TagsCurrentDto,
} from './dto/data-source.connect.dto';

@ApiBearerAuth()
@ApiTags('DataSource')
@Controller('authorized/data-source')
@UseGuards(JwtAccessGuard)
export class DataSourceAuthorizedController {
  constructor(
    private readonly service: DataSourceAuthorizedService,
    private readonly connect: DataSourceConnectService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all data sources for the current user' })
  async listDataSourceController(@Users() user: Auth.UserPayload) {
    return this.service.listDataSourceService(user.id);
  }

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new data source connection' })
  async createDataSourceController(
    @Users() user: Auth.UserPayload,
    @Body() body: CreateDataSourceDto,
  ) {
    return this.service.createDataSourceService(user.id, body);
  }

  @Patch('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an existing data source' })
  async updateDataSourceController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: UpdateDataSourceDto,
  ) {
    return this.service.updateDataSourceService(user.id, id, body);
  }

  @Delete('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a data source' })
  async deleteDataSourceController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.service.deleteDataSourceService(user.id, id);
  }

  // ── live connection ops (via FastAPI connectors) ───────────────────────────

  @Post('/test-connection')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test connection with ad-hoc credentials (before saving)',
  })
  async testAdHocConnectionController(@Body() body: AdHocSourceDto) {
    return this.connect.testConnectionAdHoc(body);
  }

  @Post('/:id/test-connection')
  @HttpCode(200)
  @ApiOperation({ summary: 'Test connection for a saved data source' })
  async testConnectionController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
  ) {
    return this.connect.testConnectionById(user.id, id);
  }

  @Post('/:id/metadata')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Fetch source metadata (PI tags / SQL tables|columns)',
  })
  async metadataController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: MetadataParamsDto,
  ) {
    return this.connect.metadataById(user.id, id, body);
  }

  @Post('/:id/fetch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fetch preview/raw rows from a saved data source' })
  async fetchController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: FetchParamsDto,
  ) {
    return this.connect.fetchById(user.id, id, body);
  }

  @Post('/:id/tags/current')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Current (snapshot) values + quality for selected PI tags',
  })
  async tagsCurrentController(
    @Users() user: Auth.UserPayload,
    @Param('id') id: string,
    @Body() body: TagsCurrentDto,
  ) {
    console.log('tagsCurrentController called with body:', body);
    return this.connect.tagsCurrentById(user.id, id, body);
  }
}
