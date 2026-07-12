import { describe, it, expect } from 'vitest';
import { getStepKeywordAtLine } from '../featureParser';

const doc = [
  'Feature: login',
  '  Scenario: ok',
  '    Given the user is on the login page',
  '    When the user submits credentials',
  '    And the form is valid',
  '    Then the dashboard is shown',
  '    But no error is shown',
  '    # a comment',
].join('\n');

describe('getStepKeywordAtLine', () => {
  it('returns the literal keyword and body for Given/When/Then', () => {
    expect(getStepKeywordAtLine(doc, 2)).toEqual({ keyword: 'Given', body: 'the user is on the login page' });
    expect(getStepKeywordAtLine(doc, 3)).toEqual({ keyword: 'When', body: 'the user submits credentials' });
    expect(getStepKeywordAtLine(doc, 5)).toEqual({ keyword: 'Then', body: 'the dashboard is shown' });
  });

  it('resolves And to the governing keyword above it', () => {
    expect(getStepKeywordAtLine(doc, 4)).toEqual({ keyword: 'When', body: 'the form is valid' });
  });

  it('resolves But to the governing keyword above it', () => {
    expect(getStepKeywordAtLine(doc, 6)).toEqual({ keyword: 'Then', body: 'no error is shown' });
  });

  it('defaults a leading And/But to Given', () => {
    const orphan = ['  Scenario: x', '    And something happens'].join('\n');
    expect(getStepKeywordAtLine(orphan, 1)).toEqual({ keyword: 'Given', body: 'something happens' });
  });

  it('returns undefined for non-step lines', () => {
    expect(getStepKeywordAtLine(doc, 0)).toBeUndefined();
    expect(getStepKeywordAtLine(doc, 7)).toBeUndefined();
  });
});
