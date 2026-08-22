import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import type { SourceUiElement } from '@rn-agent-observer/schemas';

const SOURCE_EXTENSIONS = new Set(['.tsx', '.jsx']);
const IGNORED_DIRECTORIES = new Set([
  '.artifacts',
  '.expo',
  '.git',
  'android',
  'dist',
  'ios',
  'node_modules',
]);
const KNOWN_INTERACTIVE =
  /^(?:Pressable|Button|Touchable\w*|TextInput|Switch)$/;

export function generatedSourceTestId(
  file: string,
  line: number,
  column: number,
): string {
  const hash = createHash('sha1')
    .update(`${file.replaceAll('\\', '/')}:${line}:${column}`)
    .digest('hex')
    .slice(0, 10);
  return `rnobs-${hash}`;
}

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name))
          visit(join(directory, entry.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        found.push(join(directory, entry.name));
      }
    }
  };
  visit(root);
  return found.sort();
}

function jsxName(node: ts.JsxTagNameExpression): string {
  return node.getText().split('.').at(-1) ?? node.getText();
}

function attribute(
  attributes: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function staticString(value: ts.JsxAttribute | undefined): string | null {
  const initializer = value?.initializer;
  if (!initializer) return value ? '' : null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return null;
  if (
    ts.isStringLiteral(initializer.expression) ||
    ts.isNoSubstitutionTemplateLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return null;
}

function staticBoolean(value: ts.JsxAttribute | undefined): boolean | null {
  if (!value) return null;
  if (!value.initializer) return true;
  if (!ts.isJsxExpression(value.initializer)) return null;
  if (value.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)
    return true;
  if (value.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword)
    return false;
  return null;
}

function isConditional(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isConditionalExpression(parent) ||
      ts.isIfStatement(parent) ||
      (ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
    ) {
      return true;
    }
    if (ts.isFunctionLike(parent)) break;
  }
  return false;
}

function roleFor(componentName: string): SourceUiElement['role'] {
  if (componentName === 'TextInput') return 'text-field';
  if (componentName === 'Switch') return 'switch';
  if (componentName === 'Button' || /Pressable|Touchable/.test(componentName)) {
    return 'button';
  }
  return 'other';
}

export function scanSourceUi(projectRoot: string): SourceUiElement[] {
  const elements: SourceUiElement[] = [];
  for (const file of sourceFiles(projectRoot)) {
    const content = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.JSX,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const componentName = jsxName(node.tagName);
        const hasPressHandler = Boolean(attribute(node.attributes, 'onPress'));
        if (hasPressHandler || KNOWN_INTERACTIVE.test(componentName)) {
          const position = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(),
          );
          const relativeFile = relative(projectRoot, file).replaceAll(
            '\\',
            '/',
          );
          const testIdAttribute = attribute(node.attributes, 'testID');
          const testId = staticString(testIdAttribute);
          const label =
            staticString(attribute(node.attributes, 'accessibilityLabel')) ??
            staticString(attribute(node.attributes, 'aria-label')) ??
            staticString(attribute(node.attributes, 'title'));
          elements.push({
            id: `${relativeFile}:${position.line + 1}:${position.character + 1}`,
            componentName,
            role: roleFor(componentName),
            testId: testId || null,
            generatedTestId:
              testId || testIdAttribute
                ? null
                : generatedSourceTestId(
                    relativeFile,
                    position.line + 1,
                    position.character + 1,
                  ),
            label: label || null,
            hasPressHandler,
            disabledStatic: staticBoolean(
              attribute(node.attributes, 'disabled'),
            ),
            conditionallyRendered: isConditional(node),
            source: {
              file: relativeFile,
              line: position.line + 1,
              column: position.character + 1,
            },
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return elements;
}
