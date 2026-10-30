import { config } from 'dotenv';
import { resolve } from 'node:path';

let overrides = new Set<string>();
let loadedFile: string | undefined;

// Capture externally supplied variables before dotenv fills missing values.
export function loadRuntimeEnvironment() {
  const override = process.env.DOTENV_CONFIG_OVERRIDE === 'true';
  overrides = override ? new Set() : new Set(Object.keys(process.env));
  loadedFile = resolve(process.env.DOTENV_CONFIG_PATH || '.env');
  config({ path: loadedFile, override });
}

export function runtimeEnvironmentFile() {
  return loadedFile;
}

export function environmentOverrideKeys(): ReadonlySet<string> {
  return new Set(overrides);
}
