import { z } from 'zod';

export const FindingSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  confidence: z.number().min(0).max(1),
  confidenceBasis: z.array(z.string()).optional(),
  evidence: z.array(z.string()),
  recommendation: z.string().optional(),
});

export const DiagnosisSchema = z.object({
  timestamp: z.iso.datetime(),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
