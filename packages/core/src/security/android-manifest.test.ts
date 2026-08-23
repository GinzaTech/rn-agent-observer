import { describe, expect, it } from 'vitest';
import {
  analyzeAndroidManifest,
  analyzeNetworkSecurityConfig,
} from './android-manifest.js';

describe('Android passive security analysis', () => {
  it('finds explicit high-risk release manifest settings and component exposure', () => {
    const result = analyzeAndroidManifest(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <uses-permission android:name="android.permission.READ_SMS" />
        <application
          android:debuggable="true"
          android:usesCleartextTraffic="true"
          android:allowBackup="true"
          android:networkSecurityConfig="@xml/network_security_config">
          <service android:name=".SyncService" android:exported="true" />
        </application>
      </manifest>`,
      {
        sourcePath:
          'build/intermediates/merged_manifest/release/AndroidManifest.xml',
        sourceKind: 'merged',
        buildType: 'release',
        analyzedAt: '2026-08-22T00:00:00.000Z',
      },
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'security.android.debuggable',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'security.android.cleartext',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'security.android.exported-without-permission',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'security.android.permission-review',
          outcome: 'NOT_VERIFIED',
        }),
      ]),
    );
    expect(result.evidence[0]?.sha256).toHaveLength(64);
  });

  it('only emits PASS for explicit effective settings', () => {
    const merged = analyzeAndroidManifest(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application android:debuggable="false" android:usesCleartextTraffic="false" android:allowBackup="false">
          <service android:name=".PrivateService" android:exported="false" />
        </application>
      </manifest>`,
      { sourceKind: 'merged', buildType: 'release' },
    );
    const source = analyzeAndroidManifest(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application />
      </manifest>`,
      { sourceKind: 'source' },
    );

    expect(merged.outcome).toBe('PASS');
    expect(
      merged.findings.filter((finding) => finding.outcome === 'PASS'),
    ).toHaveLength(3);
    expect(source.outcome).toBe('NOT_VERIFIED');
    expect(source.findings.every((finding) => finding.outcome !== 'PASS')).toBe(
      true,
    );
  });

  it('marks intentionally public activities for review without claiming a vulnerability', () => {
    const result = analyzeAndroidManifest(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
        <application android:debuggable="false" android:usesCleartextTraffic="false" android:allowBackup="false">
          <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
              <action android:name="android.intent.action.MAIN" />
              <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
          </activity>
        </application>
      </manifest>`,
      { sourceKind: 'merged', buildType: 'release' },
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'security.android.exported-without-permission',
        outcome: 'NOT_VERIFIED',
      }),
    );
  });

  it('returns NOT_VERIFIED for malformed XML', () => {
    const result = analyzeAndroidManifest('<manifest><application>', {
      sourcePath: 'AndroidManifest.xml',
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings[0]?.limitations[0]).toContain('could not be parsed');
  });

  it('analyzes cleartext and trust anchors in network security config', () => {
    const unsafe = analyzeNetworkSecurityConfig(
      `<network-security-config>
        <base-config cleartextTrafficPermitted="true">
          <trust-anchors><certificates src="user" /></trust-anchors>
        </base-config>
      </network-security-config>`,
      { buildType: 'release', targetSdk: 35 },
    );
    const safe = analyzeNetworkSecurityConfig(
      `<network-security-config>
        <base-config cleartextTrafficPermitted="false">
          <trust-anchors><certificates src="system" /></trust-anchors>
        </base-config>
      </network-security-config>`,
      { buildType: 'release', targetSdk: 35 },
    );

    expect(unsafe.outcome).toBe('FAIL');
    expect(unsafe.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'security.android.network.cleartext',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'security.android.network.user-ca',
          outcome: 'FAIL',
        }),
      ]),
    );
    expect(safe.outcome).toBe('PASS');
  });
});
