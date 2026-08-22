import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { scanSourceUi } from './source-model.js';

describe('source UI scanner', () => {
  it('uses the TypeScript AST to locate actionable JSX and source ownership', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-source-ui-'));
    try {
      writeFileSync(
        join(root, 'Screen.tsx'),
        `export function Screen({ready}: {ready: boolean}) {
          return <>{ready && <Pressable testID="save" accessibilityLabel="Save" onPress={() => undefined} />}
            <Button title="Missing id" onPress={() => undefined} disabled={false} />
            <Pressable testID={ready ? 'ready' : 'waiting'} onPress={() => undefined} />
          </>;
        }`,
      );
      const result = scanSourceUi(root);
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        componentName: 'Pressable',
        testId: 'save',
        generatedTestId: null,
        label: 'Save',
        hasPressHandler: true,
        conditionallyRendered: true,
        source: { file: 'Screen.tsx', line: 2 },
      });
      expect(result[1]).toMatchObject({
        componentName: 'Button',
        testId: null,
        generatedTestId: expect.stringMatching(/^rnobs-/),
        disabledStatic: false,
      });
      expect(result[2]).toMatchObject({
        testId: null,
        generatedTestId: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
