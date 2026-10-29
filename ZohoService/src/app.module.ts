import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppConfig } from './config';
import { MailService } from './mail.service';
import { AccessGuard, SessionService } from './security';
import { MailStore } from './store';
import { ZohoClient } from './zoho';
import { RebatesController } from './rebates.controller';

@Module({
  controllers: [AppController, RebatesController],
  providers: [
    AppConfig,
    SessionService,
    MailStore,
    ZohoClient,
    MailService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
