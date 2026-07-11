import { describe, it, expect } from 'vitest';
import {
  buildProposals,
  extractStepTexts,
  featureRootFor,
  stepsRootFor,
} from '../configScanner';
import { KNOWN_STEP_EXTENSIONS } from '../adapterRegistry';

const ORDERS_FEATURE = [
  'Feature: Orders',
  '  Scenario: Pay',
  '    Given I have 3 orders',
  '    When I pay 25 dollars',
].join('\n');

// Java source containing @Given("I have {int} orders") and @When("^I pay (\d+) dollars$")
const ORDERS_JAVA = [
  'public class OrderSteps {',
  '  @Given("I have {int} orders")',
  '  public void iHaveOrders(int n) {}',
  '  @When("^I pay (\\\\d+) dollars$")',
  '  public void iPay(int a) {}',
  '}',
].join('\n');

const PLAIN_JAVA = 'public class Util { public void helper() {} }';

describe('KNOWN_STEP_EXTENSIONS', () => {
  it('lists every adapter extension', () => {
    expect([...KNOWN_STEP_EXTENSIONS].sort()).toEqual(
      ['cs', 'dart', 'go', 'java', 'js', 'kt', 'py', 'rb', 'ts'],
    );
  });
});

describe('featureRootFor / stepsRootFor', () => {
  it('roots at the marker directory when present', () => {
    expect(featureRootFor('orders/features/checkout/pay.feature')).toBe('orders/features');
    expect(featureRootFor('go-legacy/feature/login.feature')).toBe('go-legacy/feature');
    expect(stepsRootFor('orders/steps/java/OrderSteps.java')).toBe('orders/steps');
    expect(stepsRootFor('ruby/step_definitions/visit_steps.rb')).toBe('ruby/step_definitions');
    expect(stepsRootFor('svc/testing/login_steps.go')).toBe('svc/testing');
  });

  it('falls back to the file directory when no marker exists', () => {
    expect(featureRootFor('specs/pay.feature')).toBe('specs');
    expect(stepsRootFor('src/glue/OrderSteps.java')).toBe('src/glue');
  });

  it('handles files at the workspace root', () => {
    expect(featureRootFor('pay.feature')).toBe('');
  });
});

describe('extractStepTexts', () => {
  it('returns the step bodies, keywords stripped', () => {
    expect(extractStepTexts(ORDERS_FEATURE)).toEqual(['I have 3 orders', 'I pay 25 dollars']);
  });
});

describe('buildProposals', () => {
  it('pairs a feature tree with the steps tree that matches its steps', () => {
    const proposals = buildProposals(
      [{ relPath: 'orders/features/pay.feature', content: ORDERS_FEATURE }],
      [{ relPath: 'orders/steps/OrderSteps.java', content: ORDERS_JAVA }],
    );
    expect(proposals).toEqual([
      {
        name: 'orders',
        featureGlob: 'orders/features/**/*.feature',
        stepsGlob: 'orders/steps/**/*.java',
        language: 'java',
        matchedSteps: 2,
        totalSteps: 2,
      },
    ]);
  });

  it('produces one proposal per project for two same-language projects', () => {
    const featureA = 'Feature: A\n  Scenario: s\n    Given alpha runs';
    const featureB = 'Feature: B\n  Scenario: s\n    Given beta runs';
    const stepsA = '@Given("alpha runs")\npublic void a() {}';
    const stepsB = '@Given("beta runs")\npublic void b() {}';
    const proposals = buildProposals(
      [
        { relPath: 'a/features/a.feature', content: featureA },
        { relPath: 'b/features/b.feature', content: featureB },
      ],
      [
        { relPath: 'a/steps/A.java', content: stepsA },
        { relPath: 'b/steps/B.java', content: stepsB },
      ],
    );
    expect(proposals.map((p) => `${p.featureGlob} -> ${p.stepsGlob}`)).toEqual([
      'a/features/**/*.feature -> a/steps/**/*.java',
      'b/features/**/*.feature -> b/steps/**/*.java',
    ]);
  });

  it('pairs by match evidence, not directory proximity', () => {
    // b/steps sits "closer" alphabetically/structurally, but only far/steps matches.
    const feature = 'Feature: X\n  Scenario: s\n    Given the widget spins';
    const near = '@Given("something unrelated")\npublic void u() {}';
    const far = '@Given("the widget spins")\npublic void w() {}';
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: feature }],
      [
        { relPath: 'x/steps/Near.java', content: near },
        { relPath: 'shared/steps/Far.java', content: far },
      ],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].stepsGlob).toBe('shared/steps/**/*.java');
    expect(proposals[0].matchedSteps).toBe(1);
  });

  it('returns [] when nothing matches', () => {
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: 'Feature: X\n  Scenario: s\n    Given nothing resolves here' }],
      [{ relPath: 'x/steps/Util.java', content: PLAIN_JAVA }],
    );
    expect(proposals).toEqual([]);
  });

  it('ignores files with unknown extensions', () => {
    const proposals = buildProposals(
      [{ relPath: 'x/features/x.feature', content: 'Feature: X\n  Scenario: s\n    Given alpha runs' }],
      [{ relPath: 'x/steps/notes.txt', content: '@Given("alpha runs")' }],
    );
    expect(proposals).toEqual([]);
  });

  it('samples at most 40 steps per feature root', () => {
    const manySteps = ['Feature: big', '  Scenario: s']
      .concat(Array.from({ length: 60 }, (_, i) => `    Given step number ${i}`))
      .join('\n');
    const defs = '@Given("step number {int}")\npublic void s(int i) {}';
    const proposals = buildProposals(
      [{ relPath: 'big/features/big.feature', content: manySteps }],
      [{ relPath: 'big/steps/S.java', content: defs }],
    );
    expect(proposals[0].totalSteps).toBe(40);
    expect(proposals[0].matchedSteps).toBe(40);
  });
});
