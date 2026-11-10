import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfig } from './config';
import { PlatformStore } from './platform-store';
import { WorkspaceContext } from './workspace-context';
import { MailStore } from './store';
import { MailService } from './mail.service';
import { ZohoClient } from './zoho';
import { OutlookClient } from './outlook';
import { OutlookMailService } from './outlook-mail.service';
import { GoogleAdsClient } from './google-ads';
import { RebateCostsService } from './rebate-costs.service';
import { SessionService } from './security';

interface WorkspaceRuntime {
  store: MailStore;
  mail: MailService;
  zoho: ZohoClient;
  outlook: OutlookClient;
  outlookMail: OutlookMailService;
  ads: GoogleAdsClient;
  costs: RebateCostsService;
}

@Injectable()
export class WorkspaceRuntimeRegistry implements OnModuleDestroy {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();

  constructor(
    private readonly platformConfig: AppConfig,
    private readonly platform: PlatformStore,
    private readonly context: WorkspaceContext,
    private readonly sessions: SessionService,
  ) {}

  private workspaceConfig(id: string): AppConfig {
    const workspace = this.platform.workspaceConfig(id);
    const config: AppConfig = Object.create(this.platformConfig);
    const settings = () => this.platform.getWorkspaceSettings(id);
    const value = (key: string, fallback = '') => settings()[key] ?? fallback;
    Object.defineProperties(config, {
      dataDir: { value: workspace.dataDir },
      encryptionKey: { value: workspace.encryptionKey },
      seedDemoData: { value: id === this.platform.defaultWorkspaceId },
      clientId: { get: () => value('ZOHO_CLIENT_ID') },
      clientSecret: { get: () => value('ZOHO_CLIENT_SECRET') },
      outlookTenant: { get: () => value('OUTLOOK_TENANT', 'common') },
      minInterval: { get: () => Math.max(2100, Number(value('ZOHO_MIN_REQUEST_INTERVAL_MS', '2100')) || 2100) },
      adsManagerAccount: { get: () => value('ADS_MANAGER_ACCOUNT') },
      adsApiVersion: { get: () => value('ADS_API_VERSION', this.platformConfig.adsApiVersion) },
      adsCredentialsJson: { get: () => value('ADS_CREDENTIALS_JSON') },
      adsCredentialsFile: { get: () => id === this.platform.defaultWorkspaceId
        ? value('ADS_CREDENTIALS_FILE', this.platformConfig.adsCredentialsFile)
        : join(workspace.dataDir, 'credentials.json') },
    });
    return config;
  }

  forWorkspace(id: string): WorkspaceRuntime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      const config = this.workspaceConfig(id);
      const store = new MailStore(config);
      try {
        this.platform.markWorkspaceInitialized(id);
        const zoho = new ZohoClient(config, store);
        const outlook = new OutlookClient(config, store);
        const outlookMail = new OutlookMailService(config, store, outlook, this.sessions);
        const mail = new MailService(config, store, zoho, this.sessions, outlookMail);
        const ads = new GoogleAdsClient(config);
        runtime = { store, zoho, outlook, outlookMail, mail, ads, costs: new RebateCostsService(store, ads) };
        this.runtimes.set(id, runtime);
      } catch (error) {
        store.onModuleDestroy();
        throw error;
      }
    }
    return runtime;
  }

  current() {
    return this.forWorkspace(this.context.current()?.workspaceId || this.platform.defaultWorkspaceId);
  }

  // Resolve once when a method is accessed; its bound instance then survives
  // awaits without following any later workspace selection or HTTP request.
  proxy<K extends keyof WorkspaceRuntime>(name: K): WorkspaceRuntime[K] {
    const lifecycle = new Set(['onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']);
    return new Proxy({} as WorkspaceRuntime[K], {
      get: (_, key) => {
        if (typeof key === 'string' && lifecycle.has(key)) return undefined;
        const target = this.current()[name];
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: (_, key, value) => Reflect.set(this.current()[name], key, value),
    });
  }

  onModuleDestroy() {
    for (const runtime of this.runtimes.values()) runtime.store.onModuleDestroy();
    this.runtimes.clear();
  }
}
