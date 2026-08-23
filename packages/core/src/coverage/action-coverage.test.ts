import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ActionCoverageInput,
  CoverageThreshold,
  DeclaredCoverageRoute,
  ObservedCoverageCheckpoint,
} from './action-coverage.js';
import {
  analyzeActionCoverage,
  deltaActionCoverage,
  mergeActionCoverageRuns,
  parseActionCoverageInput,
} from './action-coverage.js';

const TARGET = {
  platform: 'android' as const,
  deviceId: 'emulator-5554',
  appId: 'dev.rnagent.coverage',
};

const ROUTES: readonly DeclaredCoverageRoute[] = [
  {
    id: 'home',
    observable: true,
    actions: [{ id: 'home.search', observable: true }],
  },
  {
    id: 'checkout',
    observable: true,
    actions: [{ id: 'checkout.submit', observable: true }],
  },
];

const verifiedThreshold = (
  minimumCoverageRatio = 0.5,
): CoverageThreshold => ({
  minimumCoverageRatio,
  minimumObservableItems: 4,
  minimumEvidence: 2,
});

const coverageInput = (options: {
  readonly routes?: readonly DeclaredCoverageRoute[];
  readonly checkpoints?: readonly ObservedCoverageCheckpoint[];
  readonly threshold?: CoverageThreshold;
  readonly target?: typeof TARGET;
} = {}): ActionCoverageInput => ({
  target: options.target ?? TARGET,
  inventory: { routes: options.routes ?? ROUTES },
  checkpoints: options.checkpoints ?? [],
  ...(options.threshold === undefined
    ? {}
    : { threshold: options.threshold }),
});

const observation = (
  routeId: string,
  actionId: string,
): ObservedCoverageCheckpoint => ({
  routeId,
  interactions: [{ routeId, actionId }],
});

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

describe('route/action coverage', () => {
  it('parses a closed, semantic-ID-only input contract', () => {
    const parsed = parseActionCoverageInput(
      coverageInput({
        checkpoints: [observation('home', 'home.search')],
        threshold: verifiedThreshold(),
      }),
    );

    expect(parsed).toMatchObject({
      target: TARGET,
      inventory: { routes: ROUTES },
      threshold: verifiedThreshold(),
    });
    expect(() =>
      parseActionCoverageInput({
        ...coverageInput(),
        payload: 'private-payload-must-not-be-accepted',
      }),
    ).toThrow(/unsupported keys/u);
    expect(() =>
      parseActionCoverageInput({
        ...coverageInput(),
        target: { ...TARGET, deviceId: 'C:\\private\\device' },
      }),
    ).toThrow(/unsafe value/u);
    expect(() =>
      parseActionCoverageInput({
        ...coverageInput(),
        inventory: {
          routes: [
            {
              id: '../source-path',
              observable: true,
              actions: [],
            },
          ],
        },
      }),
    ).toThrow(/safe semantic identifier/u);
  });

  it('rejects duplicate routes and global semantic action identifiers', () => {
    expect(() =>
      parseActionCoverageInput(
        coverageInput({
          routes: [
            {
              id: 'home',
              observable: true,
              actions: [{ id: 'home.search', observable: true }],
            },
            {
              id: 'home',
              observable: true,
              actions: [{ id: 'checkout.submit', observable: true }],
            },
          ],
        }),
      ),
    ).toThrow(/duplicate route/u);
    expect(() =>
      parseActionCoverageInput(
        coverageInput({
          routes: [
            {
              id: 'home',
              observable: true,
              actions: [{ id: 'shared.action', observable: true }],
            },
            {
              id: 'checkout',
              observable: true,
              actions: [{ id: 'shared.action', observable: true }],
            },
          ],
        }),
      ),
    ).toThrow(/duplicate semantic action/u);
  });

  it('does not attribute an interaction from a null or unknown route to another route', () => {
    const result = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(),
        checkpoints: [
          {
            routeId: 'unknown-route',
            interactions: [
              { routeId: 'unknown-route', actionId: 'home.search' },
            ],
          },
          {
            routeId: null,
            interactions: [{ routeId: null, actionId: 'home.search' }],
          },
          {
            routeId: 'checkout',
            interactions: [
              // This action exists only on home. The known checkpoint route
              // must not cause it to be inferred or re-assigned.
              { routeId: 'checkout', actionId: 'home.search' },
            ],
          },
        ],
      }),
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.observations).toMatchObject({
      ignoredNullRoutes: 2,
      ignoredUnknownRoutes: 2,
      ignoredUnknownActions: 1,
      usableEvidence: 2,
    });
    expect(result.routes).toEqual([
      {
        routeId: 'home',
        status: 'uncovered',
        actions: [
          {
            routeId: 'home',
            actionId: 'home.search',
            status: 'uncovered',
          },
        ],
      },
      {
        routeId: 'checkout',
        status: 'covered',
        actions: [
          {
            routeId: 'checkout',
            actionId: 'checkout.submit',
            status: 'uncovered',
          },
        ],
      },
    ]);
  });

  it('reports PASS, FAIL, and NOT_VERIFIED only when the threshold evidence permits it', () => {
    const pass = analyzeActionCoverage(
      coverageInput({
        threshold: { ...verifiedThreshold(1), minimumEvidence: 4 },
        checkpoints: [
          observation('home', 'home.search'),
          observation('checkout', 'checkout.submit'),
        ],
      }),
    );
    const fail = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(0.75),
        checkpoints: [observation('home', 'home.search')],
      }),
    );
    const notVerified = analyzeActionCoverage(
      coverageInput({ threshold: verifiedThreshold() }),
    );

    expect(pass.outcome).toBe('PASS');
    expect(pass.ratios.overall).toBe(1);
    expect(fail.outcome).toBe('FAIL');
    expect(fail.ratios.overall).toBe(0.5);
    expect(notVerified.outcome).toBe('NOT_VERIFIED');
    expect(notVerified.limitations).toContain('No evidence checkpoints were supplied.');
  });

  it('keeps raw correlation values out of result evidence while retaining a hash', () => {
    const checkpointSecret = 'private-owner@example.test';
    const interactionSecret = 'private-token=not-for-reports';
    const result = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(),
        checkpoints: [
          {
            routeId: 'home',
            correlationId: checkpointSecret,
            interactions: [
              {
                routeId: 'home',
                actionId: 'home.search',
                correlationId: interactionSecret,
              },
            ],
          },
        ],
      }),
    );

    expect(result.evidenceDigests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ correlationHash: hash(checkpointSecret) }),
        expect.objectContaining({ correlationHash: hash(interactionSecret) }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(checkpointSecret);
    expect(JSON.stringify(result)).not.toContain(interactionSecret);
    expect(result.evidence.every((evidence) => evidence.sha256?.length === 64)).toBe(
      true,
    );
  });

  it('merges compatible runs and produces an honest before/after coverage delta', () => {
    const homeRun = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(),
        checkpoints: [observation('home', 'home.search')],
      }),
    );
    const checkoutRun = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(),
        checkpoints: [observation('checkout', 'checkout.submit')],
      }),
    );

    expect(homeRun.outcome).toBe('PASS');
    expect(checkoutRun.outcome).toBe('PASS');

    const merged = mergeActionCoverageRuns([homeRun, checkoutRun], {
      threshold: { ...verifiedThreshold(1), minimumEvidence: 4 },
    });
    expect(merged).toMatchObject({
      outcome: 'PASS',
      runCount: 2,
      result: { ratios: { overall: 1 } },
    });

    const delta = deltaActionCoverage(homeRun, checkoutRun);
    expect(delta.outcome).toBe('PASS');
    expect(delta.counts).toEqual({
      newCoverage: 2,
      regressions: 2,
      unchanged: 0,
      notComparable: 0,
    });
    expect(delta.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: 'home',
          change: 'regression',
        }),
        expect.objectContaining({
          routeId: 'checkout',
          change: 'new-coverage',
        }),
      ]),
    );
  });

  it('refuses to merge evidence from a different target', () => {
    const first = analyzeActionCoverage(
      coverageInput({
        threshold: verifiedThreshold(),
        checkpoints: [observation('home', 'home.search')],
      }),
    );
    const second = analyzeActionCoverage(
      coverageInput({
        target: { ...TARGET, deviceId: 'physical-device-42' },
        threshold: verifiedThreshold(),
        checkpoints: [observation('checkout', 'checkout.submit')],
      }),
    );

    expect(mergeActionCoverageRuns([first, second])).toMatchObject({
      outcome: 'NOT_VERIFIED',
      target: null,
      result: null,
    });
  });
});
