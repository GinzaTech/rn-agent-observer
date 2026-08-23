import { describe, expect, it } from 'vitest';
import appConfig from './app.config.cjs';

const { applySecurityLabConfig } = appConfig;

const baseConfig = {
  android: { package: 'dev.rnagentobserver.demo' },
};

describe('SecurityLab Expo config', () => {
  it('omits the custom scheme, intent filter, and CAMERA permission by default', () => {
    expect(applySecurityLabConfig(baseConfig, false)).toEqual(baseConfig);
  });

  it('adds the bounded Android fixture only with the explicit build flag', () => {
    const config = applySecurityLabConfig(baseConfig, true);
    expect(config.scheme).toBeUndefined();
    expect(config.android.permissions).toEqual(['android.permission.CAMERA']);
    expect(config.android.intentFilters).toEqual([
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [
          {
            scheme: 'rnobs-security-demo',
            host: 'security',
            pathPrefix: '/lab',
          },
        ],
      },
    ]);
  });

  it('removes stale fixture values when a build is not explicitly opted in', () => {
    const configured = applySecurityLabConfig(baseConfig, true);
    expect(applySecurityLabConfig(configured, false)).toEqual(baseConfig);
  });
});
