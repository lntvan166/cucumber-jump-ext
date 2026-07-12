import { describe, it, expect } from 'vitest';
import { parseDartStepDefinitions, dartAdapter } from '../dartAdapter';

describe('parseDartStepDefinitions', () => {
  it('parses given1 with generic type', () => {
    const content = "given1<int>('I have {int} cucumbers', (world, n) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses given without generic type', () => {
    const content = "given('the app is running', (world) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the app is running');
  });

  it('parses when1 with double quotes', () => {
    const content = 'when1<String>("the user enters {string}", (world, s) async {});';
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user enters {string}');
  });

  it('parses then1', () => {
    const content = "then1<int>('I should see {int} items', (world, n) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} items');
  });

  it('parses multiple steps', () => {
    const content = [
      "given('step one', (world) async {});",
      "when('step two', (world) async {});",
    ].join('\n');
    expect(parseDartStepDefinitions(content)).toHaveLength(2);
  });

  it('ignores non-step lines', () => {
    expect(parseDartStepDefinitions('final x = something();')).toHaveLength(0);
  });
});

describe('dartAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(dartAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(dartAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });

  it('does not match a step that only contains the pattern as substring', () => {
    const def = { pattern: 'the user logs in', patternLine: 0, patternStartCol: 0, patternEndCol: 16 };
    expect(dartAdapter.matchesStep(def, 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});

describe('dartAdapter escaped quotes', () => {
  it("unescapes \\' inside single-quoted patterns", () => {
    // Dart source: given1('I can\'t stop', (ctx) async {});
    const content = "given1('I can\\'t stop', (ctx) async {});";
    const defs = parseDartStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe("I can't stop");
    expect(dartAdapter.matchesStep(defs[0], "I can't stop", "i can't stop")).toBe(true);
  });
});

describe('dartAdapter.stubTemplate', () => {
  const t = dartAdapter.stubTemplate!;
  it('renders a flutter_gherkin step with arity suffix', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'dart' })).toBe(
      [
        'StepDefinitionGeneric theUserEntersAndCodes() {',
        "  return when2<String, int, World>(",
        "    'the user enters {string} and {int} codes',",
        '    (arg1, arg2, context) async {',
        '      throw UnimplementedError();',
        '    },',
        '  );',
        '}',
      ].join('\n'),
    );
  });
  it('uses no numeric suffix for zero-parameter steps', () => {
    const out = t.render({ keyword: 'Given', stepBody: 'the user is logged in', ext: 'dart' });
    expect(out).toContain('return given<World>(');
    expect(out).toContain('(context) async {');
  });
});
