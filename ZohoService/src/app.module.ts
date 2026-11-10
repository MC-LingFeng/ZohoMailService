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
import { FingerprintBrowsersController } from './fingerprint-browsers.controller';
import { PlatformStore } from './platform-store';
import { PlatformController } from './platform.controller';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceRuntimeRegistry } from './workspace-runtime';
import { WorkspaceSettingsController } from './workspace-settings.controller';

@Module({
  controllers: [AppController, RebatesController, SettingsController, FingerprintBrowsersController, PlatformController, WorkspaceSettingsController],
  providers: [
    AppConfig,
    PlatformStore,
    WorkspaceContext,
    SessionService,
    WorkspaceRuntimeRegistry,
    { provide: MailStore, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('store'), inject: [WorkspaceRuntimeRegistry] },
    { provide: ZohoClient, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('zoho'), inject: [WorkspaceRuntimeRegistry] },
    { provide: MailService, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('mail'), inject: [WorkspaceRuntimeRegistry] },
    SettingsService,
    { provide: GoogleAdsClient, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('ads'), inject: [WorkspaceRuntimeRegistry] },
    { provide: RebateCostsService, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('costs'), inject: [WorkspaceRuntimeRegistry] },
    { provide: OutlookClient, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('outlook'), inject: [WorkspaceRuntimeRegistry] },
    { provide: OutlookMailService, useFactory: (registry: WorkspaceRuntimeRegistry) => registry.proxy('outlookMail'), inject: [WorkspaceRuntimeRegistry] },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
