import { describe, it, expect } from 'vitest';
import { parseGoStepDefinitions, goAdapter } from '../goAdapter';

describe('parseGoStepDefinitions', () => {
  it('parses backtick step with named handler', () => {
    const content = [
      'func InitializeScenario(ctx *godog.ScenarioContext) {',
      '\tctx.Step(`^I have (\\d+) cucumbers$`, iHaveCucumbers)',
      '}',
    ].join('\n');
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I have (\\d+) cucumbers$');
    expect(defs[0].implFunctionName).toBe('iHaveCucumbers');
    expect(defs[0].implLine).toBeUndefined();
    expect(defs[0].patternLine).toBe(1);
  });

  it('parses double-quoted step with named handler', () => {
    const content = 's.Step("when the user logs in", loginHandler)';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('when the user logs in');
    expect(defs[0].implFunctionName).toBe('loginHandler');
  });

  it('parses anonymous func step', () => {
    const content = 'ctx.Step(`^pattern$`, func(ctx context.Context) error { return nil })';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].implFunctionName).toBeUndefined();
    expect(defs[0].implLine).toBe(0);
  });

  it('parses multiple steps', () => {
    const content = [
      'ctx.Step(`^step one$`, handlerOne)',
      'ctx.Step(`^step two$`, handlerTwo)',
    ].join('\n');
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(2);
    expect(defs[0].implFunctionName).toBe('handlerOne');
    expect(defs[1].implFunctionName).toBe('handlerTwo');
  });

  it('ignores non-step lines', () => {
    expect(parseGoStepDefinitions('someOtherFunc()')).toHaveLength(0);
  });

  it('unescapes double-quoted (interpreted) string patterns', () => {
    // Go source: ctx.Step("^I eat (\\d+) cukes$", iEat)
    const content = 'ctx.Step("^I eat (\\\\d+) cukes$", iEat)';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I eat (\\d+) cukes$');
    expect(goAdapter.matchesStep(defs[0], 'I eat 3 cukes', 'i eat 3 cukes')).toBe(true);
  });

  it('handles escaped quotes inside double-quoted patterns', () => {
    // Go source: ctx.Step("^I say \"hi\"$", say)
    const content = 'ctx.Step("^I say \\"hi\\"$", say)';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I say "hi"$');
    expect(defs[0].implFunctionName).toBe('say');
  });

  it('keeps backtick (raw) string patterns byte-for-byte', () => {
    const content = 'ctx.Step(`^I eat (\\d+) cukes$`, iEat)';
    const defs = parseGoStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I eat (\\d+) cukes$');
  });
});

describe('goAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches via normalized text', () => {
    expect(goAdapter.matchesStep(makeDef('I have cucumbers'), 'I have cucumbers', 'i have cucumbers')).toBe(true);
  });

  it('matches via regex', () => {
    expect(goAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(goAdapter.matchesStep(makeDef('I have cucumbers'), 'I eat cucumbers', 'i eat cucumbers')).toBe(false);
  });

  it('matches Cucumber Expression', () => {
    expect(goAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });
});

describe('goAdapter reverse regex', () => {
  it('treats every pattern as a regex, even unanchored ones', () => {
    expect(goAdapter.reverseRegexForPattern('I have (\\d+) cukes')).toBe('I have (\\d+) cukes');
  });
});

describe('goAdapter.stubTemplate', () => {
  const t = goAdapter.stubTemplate!;
  it('renders a godog handler with a regex registration hint', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'go' })).toBe(
      [
        '// TODO(Cucumber Jump): register this step, e.g.',
        '//   ctx.Step(`^the user enters "([^"]*)" and (\\d+) codes$`, theUserEntersAndCodes)',
        'func theUserEntersAndCodes(arg1 string, arg2 int) error {',
        '    return godog.ErrPending',
        '}',
      ].join('\n'),
    );
  });
});
