import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  snapshotDiff,
  stabilizeSnapshotRefs,
} from './snapshot.js';
import type { UITree } from '@rn-agent-observer/schemas';

function tree(elements: object[]): UITree {
  return {
    roots: elements.map((element) => ({
      type: 'View',
      children: [],
      ...element,
    })),
    timestamp: '2026-08-22T00:00:00.000Z',
    source: 'test',
  };
}

describe('ref snapshots', () => {
  it('assigns sequential refs with kinds and labels', () => {
    const snap = buildSnapshot(
      tree([
        {
          type: 'android.widget.Button',
          text: 'Buy now',
          clickable: true,
          id: 'buy-button',
        },
        { type: 'android.widget.TextView', text: 'Total: 42' },
        { type: 'android.widget.EditText', clickable: true, focusable: true },
      ]),
    );
    expect(snap.elements.map((element) => element.ref)).toEqual([
      'e1',
      'e2',
      'e3',
    ]);
    expect(snap.elements[0]).toMatchObject({
      kind: 'button',
      label: 'Buy now',
      testId: 'buy-button',
      interactive: true,
    });
    expect(snap.elements[1]).toMatchObject({
      kind: 'text',
      interactive: false,
    });
    expect(snap.elements[2]).toMatchObject({
      kind: 'text-field',
      interactive: true,
    });
  });

  it('interactiveOnly filters non-interactive text nodes', () => {
    const snap = buildSnapshot(
      tree([{ type: 'android.widget.TextView', text: 'just text' }]),
      { interactiveOnly: true },
    );
    expect(snap.elements).toHaveLength(0);
  });

  it('never exposes editable text values in snapshots', () => {
    const snap = buildSnapshot(
      tree([
        {
          type: 'android.widget.EditText',
          text: 'super-secret',
          id: 'password-input',
          clickable: true,
          focusable: true,
        },
      ]),
    );
    expect(snap.elements[0]).toMatchObject({
      kind: 'text-field',
      label: 'password-input',
      value: null,
    });
    expect(JSON.stringify(snap)).not.toContain('super-secret');
  });

  it('keeps refs stable when elements reorder and never reuses removed refs', () => {
    const first = stabilizeSnapshotRefs(
      buildSnapshot(
        tree([
          { type: 'android.widget.Button', id: 'a', clickable: true },
          { type: 'android.widget.Button', id: 'b', clickable: true },
        ]),
      ),
    );
    const second = stabilizeSnapshotRefs(
      buildSnapshot(
        tree([
          { type: 'android.widget.Button', id: 'b', clickable: true },
          { type: 'android.widget.Button', id: 'c', clickable: true },
        ]),
      ),
      first.registry,
    );
    expect(first.snapshot.elements.map((element) => element.ref)).toEqual([
      'e1',
      'e2',
    ]);
    expect(second.snapshot.elements.map((element) => element.ref)).toEqual([
      'e2',
      'e3',
    ]);
  });

  it('diffs added, removed, and changed values', () => {
    const before = buildSnapshot(
      tree([
        { type: 'android.widget.TextView', text: 'idle' },
        { type: 'android.widget.Button', text: 'Go', clickable: true },
      ]),
    );
    const after = buildSnapshot(
      tree([
        { type: 'android.widget.TextView', text: 'done' },
        { type: 'android.widget.EditText', clickable: true, focusable: true },
      ]),
    );
    const diff = snapshotDiff(before, after);
    expect(diff.changed.map((entry) => entry.label)).toEqual(['done']);
    expect(diff.changed[0]).toMatchObject({ from: 'idle', to: 'done' });
    expect(diff.removed.map((entry) => entry.label)).toEqual(['Go']);
    expect(diff.added.length).toBeGreaterThan(0);
    expect(diff.lines.some((line) => line.startsWith('= @'))).toBe(true);
  });
});
