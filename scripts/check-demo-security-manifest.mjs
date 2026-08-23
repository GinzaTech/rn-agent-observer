/* global console, process */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SECURITY_SCHEME = 'rnobs-security-demo';
const CAMERA_PERMISSION = 'android.permission.CAMERA';

function fail(message) {
  throw new Error(`Demo SecurityLab Android manifest check failed: ${message}`);
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function securityIntentFilters(manifest) {
  return [...manifest.matchAll(/<intent-filter[\s\S]*?<\/intent-filter>/gu)]
    .map((match) => match[0])
    .filter((intentFilter) => intentFilter.includes(SECURITY_SCHEME));
}

function assertBoundedSecurityIntentFilter(intentFilter) {
  if (!intentFilter.includes('android.intent.action.VIEW')) {
    fail('SecurityLab intent filter is missing the VIEW action.');
  }
  if (!intentFilter.includes('android.intent.category.BROWSABLE')) {
    fail('SecurityLab intent filter is missing the BROWSABLE category.');
  }
  if (!intentFilter.includes('android.intent.category.DEFAULT')) {
    fail('SecurityLab intent filter is missing the DEFAULT category.');
  }
  if (
    !/<data\b[^>]*android:scheme="rnobs-security-demo"[^>]*android:host="security"[^>]*android:pathPrefix="\/lab"[^>]*\/>/u.test(
      intentFilter,
    )
  ) {
    fail(
      'SecurityLab deep-link data is not limited to rnobs-security-demo://security/lab.',
    );
  }
}

const [mode, manifestArg] = process.argv.slice(2);
if (mode !== 'default' && mode !== 'opt-in') {
  fail('expected mode argument: default or opt-in.');
}

const manifestPath = path.resolve(
  manifestArg ?? 'apps/demo-expo/android/app/src/main/AndroidManifest.xml',
);
const manifest = await readFile(manifestPath, 'utf8');
const filters = securityIntentFilters(manifest);
const cameraPermissionCount = countOccurrences(manifest, CAMERA_PERMISSION);
const schemeCount = countOccurrences(manifest, SECURITY_SCHEME);

if (mode === 'default') {
  if (
    cameraPermissionCount !== 0 ||
    schemeCount !== 0 ||
    filters.length !== 0
  ) {
    fail(
      'default build must not contain the SecurityLab CAMERA permission or deep-link filter.',
    );
  }
  console.log('Demo SecurityLab default manifest is release-safe.');
} else {
  if (cameraPermissionCount !== 1) {
    fail(
      `opt-in build must declare CAMERA exactly once, found ${cameraPermissionCount}.`,
    );
  }
  if (schemeCount !== 1 || filters.length !== 1) {
    fail(
      `opt-in build must declare one SecurityLab deep-link filter, found ${schemeCount} scheme references and ${filters.length} filters.`,
    );
  }
  assertBoundedSecurityIntentFilter(filters[0]);
  console.log('Demo SecurityLab opt-in manifest is narrowly scoped.');
}
