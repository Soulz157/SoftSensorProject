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
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.authorized.dto';

@ApiBearerAuth()
@ApiTags('DataSource')
@Controller('authorized/data-source')
@UseGuards(JwtAccessGuard)
export class DataSourceAuthorizedController {
  constructor(private readonly service: DataSourceAuthorizedService) {}

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
}
