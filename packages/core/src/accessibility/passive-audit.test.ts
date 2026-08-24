import { describe, expect, it } from 'vitest';
import {
  AssuranceFindingSchema,
  type UIElement,
  type UITree,
} from '@rn-agent-observer/schemas';
import { analyzePassiveAccessibility } from './passive-audit.js';

const NOW = '2026-08-22T00:00:00.000Z';

function tree(elements: UIElement[]): UITree {
  return {
    roots: elements,
    timestamp: NOW,
    source: 'test-uiautomator',
    artifactId: 'tree-a11y-1',
    artifactPath: 'C:\\artifacts\\tree-a11y-1.json',
  };
}

function control(overrides: Partial<UIElement> = {}): UIElement {
  return {
    type: 'android.widget.Button',
    text: 'Save',
    clickable: true,
    focusable: true,
    visible: true,
    enabled: true,
    bounds: { x: 0, y: 0, width: 48, height: 48 },
    children: [],
    ...overrides,
  };
}

describe('passive accessibility pack', () => {
  it('passes only the observed name and measured touch-target scope', () => {
    const result = analyzePassiveAccessibility(
      tree([
        control(),
        control({
          type: 'android.widget.EditText',
          text: '[REDACTED]',
          contentDescription: 'Search',
          bounds: { x: 0, y: 60, width: 96, height: 48 },
        }),
      ]),
      { densityDpi: 160, analyzedAt: NOW },
    );

    expect(result.outcome).toBe('PASS');
    expect(result.counts).toMatchObject({
      observedInteractive: 2,
      missingNames: 0,
      measuredTouchTargets: 2,
      smallTouchTargets: 0,
    });
    expect(result.findings.every((finding) => finding.outcome === 'PASS')).toBe(
      true,
    );
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
    expect(result.limitations.join(' ')).toContain('Contrast');
  });

  it('does not treat resource IDs as accessible names and finds small targets', () => {
    const result = analyzePassiveAccessibility(
      tree([
        control({
          text: undefined,
          contentDescription: undefined,
          id: 'private-account-123',
          resourceId: 'save-button',
          bounds: { x: 0, y: 0, width: 32, height: 47 },
        }),
      ]),
      { densityDpi: 160, analyzedAt: NOW },
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'accessibility.observed-name',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'accessibility.touch-target',
          outcome: 'FAIL',
        }),
      ]),
    );
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-account-123');
  });

  it('returns NOT_VERIFIED for redacted names or absent density evidence', () => {
    const result = analyzePassiveAccessibility(
      tree([
        control({
          text: '[REDACTED]',
          contentDescription: undefined,
        }),
      ]),
      { analyzedAt: NOW },
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'accessibility.observed-name',
          outcome: 'NOT_VERIFIED',
        }),
        expect.objectContaining({
          ruleId: 'accessibility.touch-target',
          outcome: 'NOT_VERIFIED',
        }),
      ]),
    );
    expect(
      result.findings.flatMap((finding) => finding.limitations).join(' '),
    ).toContain('densityDpi');
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
  });

  it('does not fail a target whose observed bounds are clipped by the viewport', () => {
    const result = analyzePassiveAccessibility(
      tree([
        control({
          text: 'SecurityLab',
          bounds: { x: 20, y: 769, width: 440, height: 31 },
        }),
      ]),
      {
        densityDpi: 160,
        viewport: { width: 480, height: 800 },
        analyzedAt: NOW,
      },
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.counts.smallTouchTargets).toBe(0);
    expect(result.counts.unverifiedTouchTargets).toBe(1);
    expect(result.observations[0]?.touchTarget).toBe('not-verified');
  });

  it('does not pass when the UI tree is missing or degraded', () => {
    const missing = analyzePassiveAccessibility(undefined, { analyzedAt: NOW });
    const degraded = analyzePassiveAccessibility(tree([control()]), {
      densityDpi: 160,
      availability: { status: 'DEGRADED', reason: 'partial hierarchy' },
      analyzedAt: NOW,
    });

    expect(missing.outcome).toBe('NOT_VERIFIED');
    expect(missing.evidence).toEqual([]);
    expect(degraded.outcome).toBe('NOT_VERIFIED');
    expect(
      degraded.findings.every((finding) => finding.outcome !== 'PASS'),
    ).toBe(true);
  });

  it('rejects invalid thresholds instead of silently substituting one', () => {
    expect(() =>
      analyzePassiveAccessibility(tree([control()]), {
        densityDpi: 160,
        minimumTouchTargetDp: 0,
      }),
    ).toThrow(/minimumTouchTargetDp/u);
  });
});
