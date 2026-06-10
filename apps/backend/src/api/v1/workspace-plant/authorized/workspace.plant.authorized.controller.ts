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
import { WorkspacePlantAuthorizedService } from './workspace.plant.authorized.service';
import {
  CreateWorkspacePlantDto,
  UpdateWorkspacePlantDto,
  WorkspacePlantQueryDto,
  DeleteWorkspacePlantDto,
} from './dto/workspace.plant.authorized.dto';

@ApiBearerAuth()
@ApiTags('Authorized Workspace Plants')
@Controller('authorized/workspace-plant')
@UseGuards(JwtAccessGuard)
export class WorkspacePlantAuthorizedController {
  constructor(
    private readonly workspacePlantAuthorizedService: WorkspacePlantAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all plants for a workspace' })
  async getPlants(
    @Query() query: WorkspacePlantQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlantAuthorizedService.getPlants(query, user.id);
  }

  @Post('/:workspaceId')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new plant in a workspace' })
  async createPlant(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateWorkspacePlantDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlantAuthorizedService.createPlant(
      workspaceId,
      dto,
      user.id,
    );
  }

  @Patch('/:plantId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a plant by ID' })
  async updatePlant(
    @Param('plantId') plantId: string,
    @Body() dto: UpdateWorkspacePlantDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlantAuthorizedService.updatePlant(
      plantId,
      dto,
      user.id,
    );
  }

  @Delete('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a plant by ID' })
  async deletePlant(
    @Body() dto: DeleteWorkspacePlantDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.workspacePlantAuthorizedService.deletePlant(dto, user.id);
  }
}
