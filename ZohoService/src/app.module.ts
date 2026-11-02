import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppConfig } from './config';
import { MailService } from './mail.service';
import { AccessGuard, SessionService } from './security';
import { MailStore } from './store';
import { ZohoClient } from './zoho';
import { RebatesController } from './rebates.controller';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { GoogleAdsClient } from './google-ads';
import { RebateCostsService } from './rebate-costs.service';
import { OutlookClient } from './outlook';
import { OutlookMailService } from './outlook-mail.service';

@Module({
  controllers: [AppController, RebatesController, SettingsController],
  providers: [
    AppConfig,
    SessionService,
    MailStore,
    ZohoClient,
    MailService,
    SettingsService,
    GoogleAdsClient,
    RebateCostsService,
    OutlookClient,
    OutlookMailService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
