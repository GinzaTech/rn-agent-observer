import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  AssuranceFinding,
  EvidenceReference,
} from '@rn-agent-observer/schemas';
import { securityOutcome, type SecurityAnalysisResult } from './types.js';

export const MAX_SECRET_SCAN_BYTES = 2_097_152;

export type SecretKind =
  | 'private-key'
  | 'aws-access-key'
  | 'github-token'
  | 'slack-token'
  | 'stripe-secret-key'
  | 'google-api-key'
  | 'jwt'
  | 'bearer-token'
  | 'credential-url'
  | 'assigned-secret';

export interface SecretMatch {
  ruleId: string;
  kind: SecretKind;
  source: string;
  line: number;
  column: number;
  length: number;
  fingerprint: string;
  redactedPreview: string;
}

export interface SecretScanOptions {
  source?: string;
  analyzedAt?: string;
  fingerprintKey?: string | Uint8Array;
  maxBytes?: number;
}

export interface SecretScanResult extends SecurityAnalysisResult {
  scannedBytes: number;
  matches: SecretMatch[];
  fingerprintAlgorithm: 'hmac-sha256';
}

interface SecretPattern {
  kind: SecretKind;
  ruleId: string;
  severity: AssuranceFinding['severity'];
  expression: RegExp;
  secretGroup?: number;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    kind: 'private-key',
    ruleId: 'security.secret.private-key',
    severity: 'critical',
    expression: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    kind: 'aws-access-key',
    ruleId: 'security.secret.aws-access-key',
    severity: 'critical',
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    kind: 'github-token',
    ruleId: 'security.secret.github-token',
    severity: 'critical',
    expression: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/gu,
  },
  {
    kind: 'slack-token',
    ruleId: 'security.secret.slack-token',
    severity: 'critical',
    expression: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/gu,
  },
  {
    kind: 'stripe-secret-key',
    ruleId: 'security.secret.stripe-secret-key',
    severity: 'critical',
    expression: /\bsk_live_[A-Za-z0-9]{16,}\b/gu,
  },
  {
    kind: 'google-api-key',
    ruleId: 'security.secret.google-api-key',
    severity: 'high',
    expression: /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  },
  {
    kind: 'jwt',
    ruleId: 'security.secret.jwt',
    severity: 'high',
    expression:
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu,
  },
  {
    kind: 'bearer-token',
    ruleId: 'security.secret.bearer-token',
    severity: 'high',
    expression: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}={0,2})/giu,
    secretGroup: 1,
  },
  {
    kind: 'credential-url',
    ruleId: 'security.secret.credential-url',
    severity: 'critical',
    expression:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:([^@\s/]+)@/giu,
    secretGroup: 1,
  },
  {
    kind: 'assigned-secret',
    ruleId: 'security.secret.assigned-secret',
    severity: 'high',
    expression:
      /\b(?:api[_-]?key|client[_-]?secret|password|passwd|auth[_-]?token)\s*[:=]\s*["']?([^\s"',;]{8,})/giu,
    secretGroup: 1,
  },
];

const locationAt = (
  source: string,
  index: number,
): { line: number; column: number } => {
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
};

const evidenceFor = (text: string, source: string): EvidenceReference => {
  const sha256 = createHash('sha256').update(text).digest('hex');
  return {
    id: `secret-scan-${sha256.slice(0, 16)}`,
    kind: 'secret-scan',
    relation: 'supports',
    uri: source,
    sha256,
  };
};

export const scanSecrets = (
  text: string,
  options: SecretScanOptions = {},
): SecretScanResult => {
  const analyzedAt = options.analyzedAt ?? new Date().toISOString();
  const source = options.source ?? 'memory:text';
  const scannedBytes = Buffer.byteLength(text, 'utf8');
  const maxBytes = Math.min(
    Math.max(1, options.maxBytes ?? MAX_SECRET_SCAN_BYTES),
    MAX_SECRET_SCAN_BYTES,
  );
  const evidence = evidenceFor(text, source);
  if (scannedBytes > maxBytes) {
    const limitation = `Input is ${scannedBytes} bytes and exceeds the ${maxBytes} byte scan limit`;
    const finding: AssuranceFinding = {
      schemaVersion: '1.0',
      id: 'security.secret.scan-limit',
      ruleId: 'security.secret.scan-limit',
      title: 'Secret scan was not completed',
      description: 'The input exceeded the bounded passive scanner limit.',
      outcome: 'NOT_VERIFIED',
      severity: 'high',
      confidence: 1,
      category: 'security',
      controls: ['MASVS-STORAGE-1'],
      evidence: [evidence],
      source: { file: source },
      limitations: [limitation],
    };
    return {
      schemaVersion: '1.0',
      analyzer: 'secret-scanner',
      analyzedAt,
      outcome: 'NOT_VERIFIED',
      evidence: [evidence],
      findings: [finding],
      limitations: [limitation],
      scannedBytes,
      matches: [],
      fingerprintAlgorithm: 'hmac-sha256',
    };
  }

  const key = options.fingerprintKey ?? randomBytes(32);
  const matches: SecretMatch[] = [];
  const findings: AssuranceFinding[] = [];
  const seen = new Set<string>();
  for (const pattern of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern.expression)) {
      const full = match[0];
      const secret = pattern.secretGroup ? match[pattern.secretGroup] : full;
      if (!full || !secret || match.index === undefined) continue;
      const relativeIndex = pattern.secretGroup ? full.indexOf(secret) : 0;
      const index = match.index + Math.max(0, relativeIndex);
      const range = `${index}:${index + secret.length}`;
      if (seen.has(range)) continue;
      seen.add(range);
      const location = locationAt(text, index);
      const fingerprint = createHmac('sha256', key)
        .update(secret)
        .digest('hex');
      const redactedPreview = `[REDACTED ${pattern.kind}; ${secret.length} chars]`;
      const secretMatch: SecretMatch = {
        ruleId: pattern.ruleId,
        kind: pattern.kind,
        source,
        ...location,
        length: secret.length,
        fingerprint: `hmac-sha256:${fingerprint}`,
        redactedPreview,
      };
      matches.push(secretMatch);
      findings.push({
        schemaVersion: '1.0',
        id: `${pattern.ruleId}.${matches.length}`,
        ruleId: pattern.ruleId,
        title: `Potential ${pattern.kind} was detected`,
        description: `A credential-shaped value was found at ${source}:${location.line}:${location.column}; the value is never returned by the scanner.`,
        outcome: 'FAIL',
        severity: pattern.severity,
        confidence: pattern.kind === 'assigned-secret' ? 0.8 : 0.98,
        category: 'security',
        controls: ['MASVS-STORAGE-1', 'MASVS-PRIVACY-1'],
        evidence: [evidence],
        source: { file: source, line: location.line, column: location.column },
        remediation:
          'Revoke or rotate the credential, remove it from artifacts and history, and load secrets from an approved secret store.',
        limitations: [],
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      schemaVersion: '1.0',
      id: 'security.secret.none-detected',
      ruleId: 'security.secret.none-detected',
      title: 'No supported secret pattern was detected',
      description: 'The bounded passive pattern set completed over the input.',
      outcome: 'PASS',
      severity: 'info',
      confidence: 0.9,
      category: 'security',
      controls: ['MASVS-STORAGE-1'],
      evidence: [evidence],
      source: { file: source },
      limitations: [],
    });
  }

  return {
    schemaVersion: '1.0',
    analyzer: 'secret-scanner',
    analyzedAt,
    outcome: securityOutcome(findings),
    evidence: [evidence],
    findings,
    limitations: [
      'Pattern scanning cannot prove that no unknown, encoded, or split credential exists',
    ],
    scannedBytes,
    matches,
    fingerprintAlgorithm: 'hmac-sha256',
  };
};
