import { describe, it, expect } from 'vitest';
import { parseCsharpStepDefinitions, csharpAdapter } from '../csharpAdapter';

describe('parseCsharpStepDefinitions', () => {
  it('parses [Given] attribute', () => {
    const content = [
      '[Given("I have {int} cucumbers")]',
      'public void IHaveCucumbers(int n) {}',
    ].join('\n');
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('IHaveCucumbers');
  });

  it('parses [When] attribute', () => {
    const content = '[When("the user clicks")]\npublic void TheUserClicks() {}';
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].implFunctionName).toBe('TheUserClicks');
  });

  it('parses [StepDefinition] attribute', () => {
    const content = '[StepDefinition("any step")]\npublic void AnyStep() {}';
    const defs = parseCsharpStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('any step');
  });

  it('parses multiple attributes', () => {
    const content = [
      '[Given("step one")]',
      'public void StepOne() {}',
      '[Then("step two")]',
      'public void StepTwo() {}',
    ].join('\n');
    expect(parseCsharpStepDefinitions(content)).toHaveLength(2);
  });

  it('ignores non-attribute lines', () => {
    expect(parseCsharpStepDefinitions('public void SomeMethod() {}')).toHaveLength(0);
  });
});

describe('csharpAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(csharpAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches exact text', () => {
    expect(csharpAdapter.matchesStep(makeDef('the user logs in'), 'the user logs in', 'the user logs in')).toBe(true);
  });

  it('does not match different step', () => {
    expect(csharpAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });

  it('does not match a step that only contains the pattern as substring', () => {
    const def = { pattern: 'the user logs in', patternLine: 0, patternStartCol: 0, patternEndCol: 16 };
    expect(csharpAdapter.matchesStep(def, 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});
