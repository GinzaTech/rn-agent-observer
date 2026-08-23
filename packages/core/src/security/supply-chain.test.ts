import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  auditOsvDependencies,
  generateSupplyChainInventory,
} from './supply-chain.js';

const fixture = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'rn-observer-sbom-'));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.2.3' }),
  );
  await writeFile(
    join(directory, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      alpha:
        specifier: ^1.0.0
        version: 1.0.0
packages:
  alpha@1.0.0:
    resolution:
      integrity: sha256-YWJj
  '@scope/beta@2.0.0':
    resolution:
      integrity: sha512-ZGVm
snapshots:
  alpha@1.0.0:
    dependencies:
      '@scope/beta': 2.0.0
  '@scope/beta@2.0.0': {}
`,
  );
  return directory;
};

describe('supply-chain security', () => {
  it('generates a deterministic CycloneDX inventory from pnpm lock data', async () => {
    const directory = await fixture();
    try {
      const inventory = await generateSupplyChainInventory({
        projectRoot: directory,
        serialNumber: 'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
        now: () => new Date('2026-08-22T00:00:00.000Z'),
      });

      expect(inventory.bom).toMatchObject({
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        metadata: {
          component: { name: 'fixture-app', version: '1.2.3' },
        },
      });
      expect(inventory.componentCount).toBe(2);
      expect(inventory.bom.components).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ purl: 'pkg:npm/alpha@1.0.0' }),
          expect.objectContaining({
            purl: 'pkg:npm/%40scope/beta@2.0.0',
          }),
        ]),
      );
      expect(inventory.bom.dependencies).toContainEqual({
        ref: 'pkg:npm/alpha@1.0.0',
        dependsOn: ['pkg:npm/%40scope/beta@2.0.0'],
      });
      expect(inventory.sha256).toHaveLength(64);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('maps OSV package matches to an evidenced failing audit', async () => {
    const directory = await fixture();
    try {
      const inventory = await generateSupplyChainInventory({
        projectRoot: directory,
        serialNumber: 'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
        now: () => new Date('2026-08-22T00:00:00.000Z'),
      });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              { vulns: [] },
              {
                vulns: [
                  {
                    id: 'GHSA-test-1234',
                    modified: '2026-08-20T00:00:00Z',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await auditOsvDependencies({
        inventory,
        fetchImpl,
        now: () => new Date('2026-08-22T00:00:00.000Z'),
      });

      expect(result.outcome).toBe('FAIL');
      expect(result.advisories).toContainEqual(
        expect.objectContaining({ id: 'GHSA-test-1234' }),
      );
      expect(result.findings[0]).toMatchObject({
        outcome: 'FAIL',
        severity: 'medium',
        controls: ['MASVS-CODE-1'],
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns NOT_VERIFIED instead of passing when OSV is unavailable', async () => {
    const directory = await fixture();
    try {
      const inventory = await generateSupplyChainInventory({
        projectRoot: directory,
      });
      const result = await auditOsvDependencies({
        inventory,
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockRejectedValue(new Error('offline')),
      });

      expect(result.outcome).toBe('NOT_VERIFIED');
      expect(result.limitations[0]).toContain('offline');
      expect(result.findings[0]?.outcome).toBe('NOT_VERIFIED');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
