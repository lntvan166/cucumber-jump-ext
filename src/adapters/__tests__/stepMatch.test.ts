import { describe, it, expect } from 'vitest';
import { unescapeStringLiteral, defaultStepMatches, defaultReverseRegex } from '../stepMatch';

describe('unescapeStringLiteral', () => {
  it('collapses double backslash to single', () => {
    expect(unescapeStringLiteral('^I have (\\\\d+) cukes$')).toBe('^I have (\\d+) cukes$');
  });

  it('unescapes escaped double quotes', () => {
    expect(unescapeStringLiteral('I click \\"OK\\"')).toBe('I click "OK"');
  });

  it('unescapes escaped single quotes', () => {
    expect(unescapeStringLiteral("I can\\'t stop")).toBe("I can't stop");
  });

  it('leaves lone regex escapes intact', () => {
    expect(unescapeStringLiteral('^I have (\\d+) cukes$')).toBe('^I have (\\d+) cukes$');
  });

  it('leaves plain text unchanged', () => {
    expect(unescapeStringLiteral('the user logs in')).toBe('the user logs in');
  });
});

describe('defaultStepMatches', () => {
  it('matches unescaped anchored regex', () => {
    expect(defaultStepMatches('^I have (\\d+) cukes$', 'I have 42 cukes', 'i have 42 cukes')).toBe(true);
  });

  it('does not match literal as substring', () => {
    expect(defaultStepMatches('the user logs in', 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});

describe('defaultReverseRegex', () => {
  it('returns undefined for plain literals (normalized equality covers them)', () => {
    expect(defaultReverseRegex('the user logs in')).toBeUndefined();
  });

  it('returns the pattern as-is when anchored regex', () => {
    expect(defaultReverseRegex('^I have (\\d+) cukes$')).toBe('^I have (\\d+) cukes$');
  });

  it('converts Cucumber Expressions to a regex source', () => {
    const src = defaultReverseRegex('I have {int} cukes');
    expect(src).toBeDefined();
    expect(new RegExp(src as string).test('I have 5 cukes')).toBe(true);
    expect(new RegExp(src as string).test('I have x cukes')).toBe(false);
  });
});
