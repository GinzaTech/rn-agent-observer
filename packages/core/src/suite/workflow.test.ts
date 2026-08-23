import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ObserverCore } from '../index.js';
import { runObserverSuiteWorkflow } from './workflow.js';

describe('observer suite workflow', () => {
  it('loads, probes, executes, and reports a suite through one API', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-workflow-'));
    const suitePath = join(projectRoot, 'status.json');
    writeFileSync(
      suitePath,
      JSON.stringify({
        apiVersion: 'rn-observer/v1alpha1',
        kind: 'Suite',
        metadata: { id: 'test.status', name: 'Status' },
        steps: [
          {
            id: 'status',
            title: 'Status',
            action: { command: 'status' },
          },
        ],
        reporters: ['json'],
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const result = await runObserverSuiteWorkflow(core, {
        suiteReference: suitePath,
        createRunId: () => 'workflow-run',
        doctor: {
          checkMetro: false,
          probes: {
            nodeVersion: 'v22.12.0',
            runCommand: () => ({ ok: false, stdout: '', reason: 'not needed' }),
            probeMetro: async () => ({ ok: false }),
          },
        },
      });

      expect(result.result.outcome).toBe('PASS');
      expect(result.suite.builtin).toBe(false);
      expect(result.reports[0]?.path).toContain('workflow-run.json');
    } finally {
      core.sessions.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('does not execute an active suite command on a mismatched device', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-workflow-device-'),
    );
    const suitePath = join(projectRoot, 'launch.json');
    writeFileSync(
      suitePath,
      JSON.stringify({
        apiVersion: 'rn-observer/v1alpha1',
        kind: 'Suite',
        metadata: { id: 'test.launch', name: 'Launch' },
        steps: [
          {
            id: 'launch',
            title: 'Launch',
            risk: 'app-state',
            action: { command: 'launch' },
          },
        ],
        reporters: ['json'],
      }),
    );
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {
          appId: 'dev.rnagent.workflow-policy',
          deviceId: 'emulator-5554',
        },
        security: {
          mode: 'authorized-active',
          allowedActions: ['read', 'app-state'],
          allowedAppIds: ['dev.rnagent.workflow-policy'],
        },
      }),
    );
    const core = new ObserverCore({
      projectRoot,
      deviceId: 'emulator-5556',
      onWarning: () => {},
    });
    const launch = vi.spyOn(core.adb, 'launch');
    try {
      const result = await runObserverSuiteWorkflow(core, {
        suiteReference: suitePath,
        createRunId: () => 'workflow-device-run',
        doctor: {
          checkMetro: false,
          probes: {
            nodeVersion: 'v22.12.0',
            runCommand: () => ({
              ok: false,
              stdout: '',
              reason: 'not needed',
            }),
            probeMetro: async () => ({ ok: false }),
          },
        },
      });

      expect(result.result.steps[0]).toMatchObject({
        outcome: 'NOT_VERIFIED',
        attempts: 0,
        reason: expect.stringContaining('config.target.deviceId'),
      });
      expect(launch).not.toHaveBeenCalled();
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
