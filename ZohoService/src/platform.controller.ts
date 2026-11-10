import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AddWorkspaceMemberDto, ChangePasswordDto, CreateUserDto, UpdateWorkspaceMemberDto, WorkspaceDto } from './platform.dto';
import { PlatformStore } from './platform-store';
import { SessionService } from './security';

@Controller()
export class PlatformController {
  constructor(private readonly platform: PlatformStore, private readonly sessions: SessionService) {}
  private user(req: Request) {
    const user = this.sessions.user(req);
    if (!user) throw new UnauthorizedException('请先登录');
    return user;
  }
  @Get('me') me(@Req() req: Request) {
    const user = this.user(req);
    return { user, workspaces: this.platform.listWorkspaces(user.id), defaultWorkspaceId: this.platform.defaultWorkspaceId };
  }
  @Patch('me/password') password(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    return this.platform.changePassword(this.user(req).id, dto.currentPassword, dto.password);
  }
  @Get('workspaces') workspaces(@Req() req: Request) {
    return { workspaces: this.platform.listWorkspaces(this.user(req).id), defaultWorkspaceId: this.platform.defaultWorkspaceId };
  }
  @Post('workspaces') createWorkspace(@Req() req: Request, @Body() dto: WorkspaceDto) {
    return this.platform.createWorkspace(this.user(req).id, dto.name);
  }
  @Patch('workspaces/:id') renameWorkspace(@Req() req: Request, @Param('id') id: string, @Body() dto: WorkspaceDto) {
    return this.platform.renameWorkspace(this.user(req).id, id, dto.name);
  }
  @Get('workspaces/:id/members') members(@Req() req: Request, @Param('id') id: string) {
    return { members: this.platform.members(this.user(req).id, id) };
  }
  @Post('workspaces/:id/members') addMember(@Req() req: Request, @Param('id') id: string, @Body() dto: AddWorkspaceMemberDto) {
    return this.platform.addMember(this.user(req).id, id, dto.username, dto.role);
  }
  @Patch('workspaces/:id/members/:userId') updateMember(@Req() req: Request, @Param('id') id: string, @Param('userId') userId: string, @Body() dto: UpdateWorkspaceMemberDto) {
    return this.platform.updateMember(this.user(req).id, id, userId, dto.role);
  }
  @Delete('workspaces/:id/members/:userId') removeMember(@Req() req: Request, @Param('id') id: string, @Param('userId') userId: string) {
    return this.platform.removeMember(this.user(req).id, id, userId);
  }
  @Get('users') users(@Req() req: Request) { return { users: this.platform.listUsers(this.user(req).id) }; }
  @Post('users') createUser(@Req() req: Request, @Body() dto: CreateUserDto) {
    return this.platform.createUser(this.user(req).id, dto.username, dto.password);
  }
}
