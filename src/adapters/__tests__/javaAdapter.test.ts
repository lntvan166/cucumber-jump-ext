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

  it('unescapes regex-style annotations so \\\\d in source becomes \\d', () => {
    // Java source: @Given("^I have (\\d+) cukes$")
    const content = [
      '@Given("^I have (\\\\d+) cukes$")',
      'public void iHaveCukes(int n) {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I have (\\d+) cukes$');
    expect(javaAdapter.matchesStep(defs[0], 'I have 42 cukes', 'i have 42 cukes')).toBe(true);
  });

  it('unescapes escaped quotes inside annotations', () => {
    // Java source: @When("I click \"OK\"")
    const content = [
      '@When("I click \\"OK\\"")',
      'public void iClickOk() {}',
    ].join('\n');
    const defs = parseJavaStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I click "OK"');
    expect(javaAdapter.matchesStep(defs[0], 'I click "OK"', 'i click "ok"')).toBe(true);
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

describe('javaAdapter.stubTemplate', () => {
  const t = javaAdapter.stubTemplate!;
  it('is class-based', () => {
    expect(t.isClassBased).toBe(true);
  });
  it('renders a Java method with typed params', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin" and 3 codes', ext: 'java' })).toBe(
      [
        '@When("the user enters {string} and {int} codes")',
        'public void the_user_enters_and_codes(String arg1, int arg2) {',
        '    throw new io.cucumber.java.PendingException();',
        '}',
      ].join('\n'),
    );
  });
  it('renders Kotlin syntax for .kt targets', () => {
    expect(t.render({ keyword: 'Then', stepBody: 'the total is 5', ext: 'kt' })).toBe(
      [
        '@Then("the total is {int}")',
        'fun the_total_is(arg1: Int) {',
        '    throw io.cucumber.java.PendingException()',
        '}',
      ].join('\n'),
    );
  });
});
