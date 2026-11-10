import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface WorkspaceScope {
  workspaceId?: string;
  userId?: string;
  role?: 'owner' | 'member';
  isPlatformAdmin?: boolean;
}

@Injectable()
export class WorkspaceContext {
  private readonly storage = new AsyncLocalStorage<WorkspaceScope>();

  run<T>(callback: () => T): T {
    return this.storage.run({}, callback);
  }

  current() {
    return this.storage.getStore();
  }

  set(value: WorkspaceScope) {
    const current = this.storage.getStore();
    if (current) Object.assign(current, value);
    else this.storage.enterWith({ ...value });
  }
}
