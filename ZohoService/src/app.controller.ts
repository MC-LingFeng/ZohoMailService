import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig } from './config';
import {
  BindAccountDto,
  ListMessagesDto,
  LoginDto,
  SendDto,
  UpdateAccountDto,
} from './dto';
import { MailService } from './mail.service';
import { SessionService } from './security';

@Controller()
export class AppController {
  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
  ) {}
  @Get('status') status(@Req() req: Request) {
    return {
      name: 'ZoHome',
      mode: this.config.mode,
      oauthConfigured: this.config.oauthConfigured,
      authenticated: this.sessions.authenticated(req),
      manualCredentialsSupported: true,
    };
  }
  @Post('session') login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    return this.sessions.login(req, res, dto.password);
  }
  @Delete('session') logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sessions.logout(req, res);
  }
  @Get('accounts') accounts() {
    return this.mail.accounts();
  }
  @Get('overview') overview() {
    return this.mail.overview();
  }
  @Get('activity') activity() {
    return this.mail.activity();
  }
  @Patch('accounts/:id') update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.mail.update(id, dto);
  }
  @Delete('accounts/:id') disconnect(@Param('id') id: string) {
    return this.mail.disconnect(id);
  }
  @Get('accounts/:id/messages') messages(
    @Param('id') id: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.mail.list(id, query);
  }
  @Get('accounts/:id/folders') folders(@Param('id') id: string) {
    return this.mail.listFolders(id);
  }
  @Get('accounts/:id/messages/:messageId') detail(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('folderId') folderId: string,
  ) {
    return this.mail.detail(id, messageId, folderId);
  }
  @Post('accounts/:id/send') send(
    @Param('id') id: string,
    @Body() dto: SendDto,
  ) {
    return this.mail.send(id, dto);
  }
  @Post('accounts/:id/sync') sync(
    @Param('id') id: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.mail.sync(id, query);
  }
  @Post('auth/zoho/url') authorization(
    @Req() req: Request,
    @Body() dto: BindAccountDto,
  ) {
    return this.mail.authorizationUrl(req, dto);
  }
  @Post('auth/outlook/url') outlookAuthorization(
    @Req() req: Request,
    @Body() dto: BindAccountDto,
  ) {
    return this.mail.outlookAuthorizationUrl(req, dto);
  }
  @Post('accounts/:id/reauthorize') reauthorize(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.mail.reauthorize(id, req);
  }
  @Get('auth/zoho/callback') async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('location') location?: string,
  ) {
    let result: string;
    try {
      await this.mail.callback(req, code, state, location);
      result = 'connected=1';
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '邮箱连接失败，请重试';
      result = `error=${encodeURIComponent(message)}`;
    }
    res.redirect(
      `${this.config.frontendUrl.replace(/\/$/, '')}/accounts?${result}`,
    );
  }
  @Get('auth/outlook/callback') async outlookCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    let result: string;
    try {
      await this.mail.outlookCallback(req, code, state);
      result = 'connected=1';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outlook 邮箱连接失败，请重试';
      result = `error=${encodeURIComponent(message)}`;
    }
    res.redirect(`${this.config.frontendUrl.replace(/\/$/, '')}/accounts?provider=outlook&${result}`);
  }
}
