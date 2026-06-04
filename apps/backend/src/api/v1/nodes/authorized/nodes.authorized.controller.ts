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
import { NodesAuthorizedService } from './nodes.authorized.service';
import {
  CreateNodeDto,
  NodeQueryDto,
  UpdateNodeDto,
} from './dto/nodes.authorized.dto';

@ApiBearerAuth()
@ApiTags('Authorized Nodes')
@Controller('authorized/nodes')
@UseGuards(JwtAccessGuard)
export class NodesAuthorizedController {
  constructor(
    private readonly nodesAuthorizedService: NodesAuthorizedService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'List all nodes for a workspace' })
  async listByWorkspace(@Query() query: NodeQueryDto) {
    return this.nodesAuthorizedService.listByWorkspace(query.workspaceId);
  }

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new node in a workspace' })
  async create(@Body() dto: CreateNodeDto) {
    return this.nodesAuthorizedService.create(dto.workspaceId, dto.data);
  }

  @Patch('/:nodeId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a node by ID' })
  async update(@Param('nodeId') nodeId: string, @Body() dto: UpdateNodeDto) {
    return this.nodesAuthorizedService.update(nodeId, dto.data);
  }

  @Delete('/:nodeId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a node by ID' })
  async remove(@Param('nodeId') nodeId: string) {
    return this.nodesAuthorizedService.remove(nodeId);
  }
}
