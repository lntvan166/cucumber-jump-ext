import { describe, it, expect } from 'vitest';
import { parsePythonStepDefinitions, pythonAdapter } from '../pythonAdapter';

describe('parsePythonStepDefinitions', () => {
  it('parses @given decorator', () => {
    const content = [
      "@given('I have {n:d} cucumbers')",
      'def step_impl(context, n):',
      '    pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {n:d} cucumbers');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('step_impl');
  });

  it('parses double-quoted @when', () => {
    const content = [
      '@when("the user clicks submit")',
      'def click_submit(context):',
      '    pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user clicks submit');
    expect(defs[0].implFunctionName).toBe('click_submit');
  });

  it('parses @step decorator', () => {
    const content = "@step('generic step')\ndef do_thing(context): pass";
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('generic step');
  });

  it('parses multiple steps', () => {
    const content = [
      "@given('step one')",
      'def step_one(ctx): pass',
      '',
      "@then('step two')",
      'def step_two(ctx): pass',
    ].join('\n');
    const defs = parsePythonStepDefinitions(content);
    expect(defs).toHaveLength(2);
  });

  it('ignores non-decorator lines', () => {
    expect(parsePythonStepDefinitions('def some_helper(context): pass')).toHaveLength(0);
  });
});

describe('pythonAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches normalized text', () => {
    expect(pythonAdapter.matchesStep(makeDef('the user logs in'), 'the user logs in', 'the user logs in')).toBe(true);
  });

  it('matches Cucumber Expression', () => {
    expect(pythonAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(pythonAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });

  it('does not match a step that only contains the pattern as substring', () => {
    const def = { pattern: 'the user logs in', patternLine: 0, patternStartCol: 0, patternEndCol: 16 };
    expect(pythonAdapter.matchesStep(def, 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});
