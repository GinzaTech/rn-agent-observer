import type {
  AssuranceFinding,
  EvidenceReference,
} from '@rn-agent-observer/schemas';

export interface SecurityAnalysisResult {
  schemaVersion: '1.0';
  analyzer: string;
  analyzedAt: string;
  outcome: 'PASS' | 'FAIL' | 'NA' | 'NOT_VERIFIED';
  evidence: EvidenceReference[];
  findings: AssuranceFinding[];
  limitations: string[];
}

export const securityOutcome = (
  findings: readonly AssuranceFinding[],
): SecurityAnalysisResult['outcome'] => {
  if (findings.some((finding) => finding.outcome === 'FAIL')) return 'FAIL';
  if (findings.some((finding) => finding.outcome === 'NOT_VERIFIED')) {
    return 'NOT_VERIFIED';
  }
  if (findings.some((finding) => finding.outcome === 'PASS')) return 'PASS';
  return 'NA';
};
