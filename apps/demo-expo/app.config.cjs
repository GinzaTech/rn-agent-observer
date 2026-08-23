/* global module, process, require */
/* eslint-disable @typescript-eslint/no-require-imports */

const appJson = require('./app.json');

const SECURITY_LAB_SCHEME = 'rnobs-security-demo';
const CAMERA_PERMISSION = 'android.permission.CAMERA';
const SECURITY_LAB_INTENT_FILTER = {
  action: 'VIEW',
  category: ['BROWSABLE', 'DEFAULT'],
  data: [
    {
      scheme: SECURITY_LAB_SCHEME,
      host: 'security',
      pathPrefix: '/lab',
    },
  ],
};

function isSecurityLabIntentFilter(value) {
  return (
    value &&
    Array.isArray(value.data) &&
    value.data.some((data) => data && data.scheme === SECURITY_LAB_SCHEME)
  );
}

function withoutSecurityLab(config) {
  const android = { ...(config.android ?? {}) };
  const permissions = Array.isArray(android.permissions)
    ? android.permissions.filter(
        (permission) => permission !== CAMERA_PERMISSION,
      )
    : [];
  const intentFilters = Array.isArray(android.intentFilters)
    ? android.intentFilters.filter(
        (intentFilter) => !isSecurityLabIntentFilter(intentFilter),
      )
    : [];

  if (permissions.length > 0) android.permissions = permissions;
  else delete android.permissions;
  if (intentFilters.length > 0) android.intentFilters = intentFilters;
  else delete android.intentFilters;

  const result = { ...config, android };
  if (result.scheme === SECURITY_LAB_SCHEME) delete result.scheme;
  return result;
}

function applySecurityLabConfig(config, enabled) {
  const base = withoutSecurityLab(config);
  if (!enabled) return base;
  return {
    ...base,
    android: {
      ...base.android,
      permissions: [...(base.android.permissions ?? []), CAMERA_PERMISSION],
      intentFilters: [
        ...(base.android.intentFilters ?? []),
        SECURITY_LAB_INTENT_FILTER,
      ],
    },
  };
}

function appConfig({ config } = {}) {
  const baseConfig = config ?? appJson.expo;
  return applySecurityLabConfig(
    baseConfig,
    process.env.RN_OBSERVER_SECURITY_LAB === '1',
  );
}

module.exports = appConfig;
module.exports.applySecurityLabConfig = applySecurityLabConfig;
