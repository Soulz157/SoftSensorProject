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
import { NodesAuthorizedService } from './nodes.authorized.service';
import {
  CreateNodeDto,
  NodeQueryDto,
  UpdateNodeDto,
  DeleteNodeDto,
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
  async listByWorkspace(
    @Query() query: NodeQueryDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.nodesAuthorizedService.listByWorkspace(
      query.workspaceId,
      user.id,
      user.role,
      query.planId,
    );
  }

  @Post('/')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new node in a workspace' })
  async createNodeController(
    @Body() dto: CreateNodeDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.nodesAuthorizedService.createNodeService(
      dto.workspaceId,
      dto.planId,
      user.id,
      dto.data,
    );
  }

  @Patch('/:nodeId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a node by ID' })
  async updateNodeController(
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateNodeDto,
    @Users() user: Auth.UserPayload,
  ) {
    return this.nodesAuthorizedService.updateNodeService(
      nodeId,
      user.id,
      dto.data,
    );
  }

  @Delete('/')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a node by ID' })
  async deleteNodeController(
    @Users() user: Auth.UserPayload,
    @Body() args: DeleteNodeDto,
  ) {
    return this.nodesAuthorizedService.deleteNodeService(args.nodeId, user.id);
  }
}
