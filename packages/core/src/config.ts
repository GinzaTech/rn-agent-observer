import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObserverError } from './errors.js';

interface ExpoConfigFile {
  expo?: { android?: { package?: string }; scheme?: string | string[] };
}

export function readExpoConfig(projectRoot: string): ExpoConfigFile | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, 'app.json'), 'utf8'),
    ) as ExpoConfigFile;
  } catch {
    return null;
  }
}

export function resolveAppId(projectRoot: string, explicit?: string): string {
  const appId =
    explicit ??
    process.env.RN_OBSERVER_APP_ID ??
    readExpoConfig(projectRoot)?.expo?.android?.package;
  if (!appId) {
    throw new ObserverError(
      'APP_ID_NOT_FOUND',
      'Android application ID could not be resolved',
      true,
      'Set RN_OBSERVER_APP_ID or expo.android.package in app.json',
    );
  }
  return appId;
}
