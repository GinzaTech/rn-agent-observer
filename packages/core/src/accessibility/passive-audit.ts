import { createHash } from 'node:crypto';
import type {
  AssuranceFinding,
  AssuranceOutcome,
  EvidenceAvailability,
  EvidenceReference,
  UIElement,
  UITree,
} from '@rn-agent-observer/schemas';
import { flattenUiTree } from '../adb/parsers.js';

const DEFAULT_MINIMUM_TOUCH_TARGET_DP = 48;
const REDACTED_TEXT = /\[REDACTED(?:_[A-Z]+)?\]/u;

export interface PassiveAccessibilityOptions {
  densityDpi?: number | null;
  minimumTouchTargetDp?: number;
  availability?: EvidenceAvailability;
  evidence?: EvidenceReference[];
  analyzedAt?: string;
}

export interface AccessibilityElementObservation {
  ref: string;
  interactive: boolean;
  clickable: boolean;
  visibility: 'visible' | 'hidden' | 'unknown';
  name: 'observed' | 'missing' | 'redacted-or-unknown';
  touchTarget: 'pass' | 'fail' | 'not-applicable' | 'not-verified';
  widthDp?: number;
  heightDp?: number;
}

export interface PassiveAccessibilityResult {
  schemaVersion: '1.0';
  analyzer: 'accessibility.passive-observed';
  analyzedAt: string;
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  evidence: EvidenceReference[];
  findings: AssuranceFinding[];
  observations: AccessibilityElementObservation[];
  counts: {
    observedInteractive: number;
    unknownVisibility: number;
    missingNames: number;
    unverifiedNames: number;
    measuredTouchTargets: number;
    smallTouchTargets: number;
    unverifiedTouchTargets: number;
  };
  limitations: string[];
}

interface IndexedElement {
  element: UIElement;
  ref: string;
}

const resultOutcome = (
  findings: readonly AssuranceFinding[],
): PassiveAccessibilityResult['outcome'] => {
  if (findings.some((finding) => finding.outcome === 'FAIL')) return 'FAIL';
  if (findings.some((finding) => finding.outcome === 'NOT_VERIFIED')) {
    return 'NOT_VERIFIED';
  }
  return 'PASS';
};

const treeEvidence = (tree: UITree): EvidenceReference => {
  const sha256 = createHash('sha256')
    .update(JSON.stringify(tree))
    .digest('hex');
  const artifactId = tree.artifactId?.trim();
  return {
    id: artifactId || `ui-tree-${sha256.slice(0, 16)}`,
    kind: 'ui-tree',
    relation: 'supports',
    ...(tree.artifactPath ? { uri: tree.artifactPath } : {}),
    sha256,
  };
};

const finding = (input: {
  suffix: string;
  ruleId: string;
  title: string;
  description: string;
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  severity: AssuranceFinding['severity'];
  confidence: number;
  evidence: EvidenceReference[];
  remediation?: string | undefined;
  limitation?: string | undefined;
}): AssuranceFinding => ({
  schemaVersion: '1.0',
  id: `${input.ruleId}.${input.suffix}`,
  ruleId: input.ruleId,
  title: input.title,
  description: input.description,
  outcome: input.outcome,
  severity: input.severity,
  confidence: input.confidence,
  category: 'accessibility',
  controls: [],
  evidence: input.evidence,
  ...(input.remediation ? { remediation: input.remediation } : {}),
  limitations: input.limitation ? [input.limitation] : [],
});

const isEditable = (element: UIElement): boolean =>
  /EditText|TextInput/iu.test(`${element.type} ${element.className ?? ''}`);

const nameStatus = (
  element: UIElement,
): AccessibilityElementObservation['name'] => {
  const candidates = [
    element.contentDescription,
    ...(isEditable(element) ? [] : [element.text]),
  ].filter(
    (value): value is string => value !== undefined && value.trim() !== '',
  );
  if (candidates.some((value) => !REDACTED_TEXT.test(value))) {
    return 'observed';
  }
  return candidates.length > 0 ? 'redacted-or-unknown' : 'missing';
};

const visibility = (
  element: UIElement,
): AccessibilityElementObservation['visibility'] => {
  if (element.visible === true) return 'visible';
  if (element.visible === false) return 'hidden';
  return 'unknown';
};

const unavailableFinding = (
  ruleId: string,
  title: string,
  reason: string,
  evidence: EvidenceReference[],
): AssuranceFinding =>
  finding({
    suffix: 'not-verified',
    ruleId,
    title,
    description: `${title} could not be evaluated from the supplied evidence.`,
    outcome: 'NOT_VERIFIED',
    severity: 'medium',
    confidence: 1,
    evidence,
    limitation: reason,
  });

/**
 * Audits only properties explicitly observable in the current UI tree. It
 * never treats resource/test IDs as accessible names and never infers route,
 * focus order, contrast, announcements, or off-screen behavior.
 */
export function analyzePassiveAccessibility(
  tree: UITree | undefined,
  options: PassiveAccessibilityOptions = {},
): PassiveAccessibilityResult {
  const minimumTouchTargetDp =
    options.minimumTouchTargetDp ?? DEFAULT_MINIMUM_TOUCH_TARGET_DP;
  if (!Number.isFinite(minimumTouchTargetDp) || minimumTouchTargetDp <= 0) {
    throw new RangeError('minimumTouchTargetDp must be a positive number');
  }

  const evidence =
    options.evidence && options.evidence.length > 0
      ? options.evidence
      : tree
        ? [treeEvidence(tree)]
        : [];
  const evidenceSuffix = evidence[0]?.id ?? 'unavailable';
  const limitations = [
    'The audit covers only controls present in the supplied current UI tree; off-screen and unmounted controls are not verified.',
    'Contrast, focus order, assistive-technology announcements, keyboard behavior, font scaling, and reduced-motion behavior require dedicated evidence.',
    'A PASS applies only to observed accessible names and measured touch targets, not to overall accessibility compliance.',
  ];
  const unavailableReason = !tree
    ? 'A UI tree was not supplied.'
    : options.availability?.status === 'UNAVAILABLE'
      ? options.availability.reason
      : null;
  if (unavailableReason) {
    const findings = [
      unavailableFinding(
        'accessibility.observed-name',
        'Observed controls expose an accessible name',
        unavailableReason,
        evidence,
      ),
      unavailableFinding(
        'accessibility.touch-target',
        'Observed touch targets meet the configured minimum',
        unavailableReason,
        evidence,
      ),
    ];
    return {
      schemaVersion: '1.0',
      analyzer: 'accessibility.passive-observed',
      analyzedAt: options.analyzedAt ?? new Date().toISOString(),
      outcome: 'NOT_VERIFIED',
      evidence,
      findings,
      observations: [],
      counts: {
        observedInteractive: 0,
        unknownVisibility: 0,
        missingNames: 0,
        unverifiedNames: 0,
        measuredTouchTargets: 0,
        smallTouchTargets: 0,
        unverifiedTouchTargets: 0,
      },
      limitations: [...limitations, unavailableReason],
    };
  }
  if (!tree) {
    throw new Error('Accessibility analyzer invariant: UI tree is unavailable');
  }

  const indexed: IndexedElement[] = flattenUiTree(tree.roots).map(
    (element, index) => ({ element, ref: `ui-${index + 1}` }),
  );
  const interactive = indexed.filter(
    ({ element }) => element.clickable === true || element.focusable === true,
  );
  const densityDpi = options.densityDpi;
  const densityAvailable =
    densityDpi !== undefined &&
    densityDpi !== null &&
    Number.isFinite(densityDpi) &&
    densityDpi > 0;
  const observations: AccessibilityElementObservation[] = interactive.map(
    ({ element, ref }) => {
      const observedVisibility = visibility(element);
      const observedName = nameStatus(element);
      const touchCandidate =
        element.clickable === true &&
        element.enabled !== false &&
        observedVisibility !== 'hidden';
      if (!touchCandidate) {
        return {
          ref,
          interactive: true,
          clickable: element.clickable === true,
          visibility: observedVisibility,
          name: observedName,
          touchTarget: 'not-applicable',
        };
      }
      if (
        observedVisibility !== 'visible' ||
        !densityAvailable ||
        !element.bounds
      ) {
        return {
          ref,
          interactive: true,
          clickable: true,
          visibility: observedVisibility,
          name: observedName,
          touchTarget: 'not-verified',
        };
      }
      const widthDp = (element.bounds.width * 160) / densityDpi;
      const heightDp = (element.bounds.height * 160) / densityDpi;
      return {
        ref,
        interactive: true,
        clickable: true,
        visibility: observedVisibility,
        name: observedName,
        touchTarget:
          widthDp < minimumTouchTargetDp || heightDp < minimumTouchTargetDp
            ? 'fail'
            : 'pass',
        widthDp: Math.round(widthDp * 10) / 10,
        heightDp: Math.round(heightDp * 10) / 10,
      };
    },
  );
  const visible = observations.filter(
    (observation) => observation.visibility === 'visible',
  );
  const unknownVisibility = observations.filter(
    (observation) => observation.visibility === 'unknown',
  ).length;
  const missingNames = visible.filter(
    (observation) => observation.name === 'missing',
  ).length;
  const unverifiedNames =
    visible.filter((observation) => observation.name === 'redacted-or-unknown')
      .length + unknownVisibility;
  const measuredTouchTargets = observations.filter(
    (observation) =>
      observation.touchTarget === 'pass' || observation.touchTarget === 'fail',
  ).length;
  const smallTouchTargets = observations.filter(
    (observation) => observation.touchTarget === 'fail',
  ).length;
  const unverifiedTouchTargets = observations.filter(
    (observation) => observation.touchTarget === 'not-verified',
  ).length;
  const degradedReason =
    options.availability?.status === 'DEGRADED'
      ? options.availability.reason
      : null;

  let nameOutcome: Exclude<AssuranceOutcome, 'NA'>;
  let nameLimitation: string | undefined;
  if (missingNames > 0) {
    nameOutcome = 'FAIL';
    if (degradedReason) {
      nameLimitation = `UI-tree evidence was degraded: ${degradedReason}`;
    }
  } else if (visible.length === 0) {
    nameOutcome = 'NOT_VERIFIED';
    nameLimitation =
      'No explicitly visible interactive controls were observed.';
  } else if (unverifiedNames > 0) {
    nameOutcome = 'NOT_VERIFIED';
    nameLimitation = `${unverifiedNames} controls had unknown visibility or a redacted name.`;
  } else if (degradedReason) {
    nameOutcome = 'NOT_VERIFIED';
    nameLimitation = `UI-tree evidence was degraded: ${degradedReason}`;
  } else nameOutcome = 'PASS';

  let touchOutcome: Exclude<AssuranceOutcome, 'NA'>;
  let touchLimitation: string | undefined;
  if (smallTouchTargets > 0) {
    touchOutcome = 'FAIL';
    if (degradedReason) {
      touchLimitation = `UI-tree evidence was degraded: ${degradedReason}`;
    }
  } else if (!densityAvailable) {
    touchOutcome = 'NOT_VERIFIED';
    touchLimitation =
      'A positive device densityDpi measurement was not supplied.';
  } else if (measuredTouchTargets === 0) {
    touchOutcome = 'NOT_VERIFIED';
    touchLimitation =
      'No explicitly visible, enabled clickable target with bounds was observed.';
  } else if (unverifiedTouchTargets > 0) {
    touchOutcome = 'NOT_VERIFIED';
    touchLimitation = `${unverifiedTouchTargets} clickable targets lacked explicit visibility or bounds evidence.`;
  } else if (degradedReason) {
    touchOutcome = 'NOT_VERIFIED';
    touchLimitation = `UI-tree evidence was degraded: ${degradedReason}`;
  } else touchOutcome = 'PASS';

  const findings = [
    finding({
      suffix: evidenceSuffix,
      ruleId: 'accessibility.observed-name',
      title: 'Observed controls expose an accessible name',
      description:
        missingNames > 0
          ? `${missingNames} explicitly visible interactive controls had no observed text or content description.`
          : `${visible.length} explicitly visible interactive controls were checked for an observed name.`,
      outcome: nameOutcome,
      severity: missingNames > 0 ? 'high' : 'info',
      confidence: nameOutcome === 'NOT_VERIFIED' ? 1 : 0.95,
      evidence,
      remediation:
        missingNames > 0
          ? 'Provide a meaningful accessibility label/content description without relying on testID or resource ID.'
          : undefined,
      limitation: nameLimitation,
    }),
    finding({
      suffix: evidenceSuffix,
      ruleId: 'accessibility.touch-target',
      title: 'Observed touch targets meet the configured minimum',
      description:
        smallTouchTargets > 0
          ? `${smallTouchTargets} measured clickable targets were smaller than ${minimumTouchTargetDp}dp on at least one axis.`
          : `${measuredTouchTargets} clickable targets were measured against a ${minimumTouchTargetDp}dp minimum.`,
      outcome: touchOutcome,
      severity: smallTouchTargets > 0 ? 'medium' : 'info',
      confidence: touchOutcome === 'NOT_VERIFIED' ? 1 : 0.95,
      evidence,
      remediation:
        smallTouchTargets > 0
          ? `Increase the interactive hit area to at least ${minimumTouchTargetDp}dp on both axes, then recapture the UI tree at the same density.`
          : undefined,
      limitation: touchLimitation,
    }),
  ];
  return {
    schemaVersion: '1.0',
    analyzer: 'accessibility.passive-observed',
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    outcome: resultOutcome(findings),
    evidence,
    findings,
    observations,
    counts: {
      observedInteractive: visible.length,
      unknownVisibility,
      missingNames,
      unverifiedNames,
      measuredTouchTargets,
      smallTouchTargets,
      unverifiedTouchTargets,
    },
    limitations: [
      ...limitations,
      ...(degradedReason
        ? [`UI-tree evidence was degraded: ${degradedReason}`]
        : []),
    ],
  };
}
