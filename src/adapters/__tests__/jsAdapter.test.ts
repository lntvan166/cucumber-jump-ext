import { describe, it, expect } from 'vitest';
import { parseJsStepDefinitions, jsAdapter } from '../jsAdapter';

describe('parseJsStepDefinitions', () => {
  it('parses single-quoted string step', () => {
    const content = "Given('I have {int} cucumbers', function(n) {});";
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses double-quoted string step', () => {
    const content = 'When("the user logs in", (ctx) => {});';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user logs in');
  });

  it('parses template-literal step', () => {
    const content = 'Then(`I should see {int} results`, fn);';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} results');
  });

  it('parses regex step', () => {
    const content = 'Given(/^I have (\\d+) cucumbers$/, function(n) {});';
    const defs = parseJsStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I have (\\d+) cucumbers$');
  });

  it('parses multiple steps', () => {
    const content = [
      "Given('step one', fn);",
      "When('step two', fn);",
    ].join('\n');
    expect(parseJsStepDefinitions(content)).toHaveLength(2);
  });

  it('ignores non-step lines', () => {
    expect(parseJsStepDefinitions('const x = someFunction();')).toHaveLength(0);
  });
});

describe('jsAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(jsAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches regex pattern', () => {
    expect(jsAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(jsAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });
});
