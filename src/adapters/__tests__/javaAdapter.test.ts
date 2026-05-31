import { describe, it, expect } from 'vitest';
import { parseJavaStepDefinitions, javaAdapter } from '../javaAdapter';

describe('parseJavaStepDefinitions', () => {
  it('parses @Given annotation', () => {
    const content = [
      '@Given("I have {int} cucumbers in a basket")',
      'public void iHaveCucumbers(int n) {',
      '}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers in a basket');
    expect(defs[0].patternLine).toBe(0);
    expect(defs[0].implLine).toBe(1);
    expect(defs[0].implFunctionName).toBe('iHaveCucumbers');
  });

  it('parses Kotlin @When annotation', () => {
    const content = [
      '@When("the user clicks submit")',
      'fun theUserClicksSubmit() {',
      '}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user clicks submit');
    expect(defs[0].implFunctionName).toBe('theUserClicksSubmit');
  });

  it('parses @Then annotation', () => {
    const content = [
      '@Then("I should see {int} results")',
      'public void iShouldSeeResults(int count) {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I should see {int} results');
  });

  it('parses multiple annotations', () => {
    const content = [
      '@Given("step one")',
      'public void stepOne() {}',
      '',
      '@When("step two")',
      'public void stepTwo() {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(2);
    expect(defs[0].bodyEndLine).toBeLessThan(defs[1].patternLine);
  });

  it('ignores non-annotation lines', () => {
    expect(parseJavaStepDefinitions('public void someMethod() {}')).toHaveLength(0);
  });
});

describe('javaAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(javaAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches exact text', () => {
    expect(javaAdapter.matchesStep(makeDef('the user logs in'), 'the user logs in', 'the user logs in')).toBe(true);
  });

  it('does not match different step', () => {
    expect(javaAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });

  it('does not match a step that only contains the pattern as substring', () => {
    const def = { pattern: 'the user logs in', patternLine: 0, patternStartCol: 0, patternEndCol: 16 };
    expect(javaAdapter.matchesStep(def, 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});
