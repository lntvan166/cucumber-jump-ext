import { describe, it, expect } from 'vitest';
import { cucumberExpressionToRegex, isCucumberExpression } from '../cucumberExpression';

describe('isCucumberExpression', () => {
  it('returns true for {int}', () => expect(isCucumberExpression('I have {int} cucumbers')).toBe(true));
  it('returns false for plain regex', () => expect(isCucumberExpression('^I have (\\d+) cucumbers$')).toBe(false));
});

describe('cucumberExpressionToRegex', () => {
  it('converts {int}', () => {
    const re = cucumberExpressionToRegex('I have {int} cucumbers');
    expect(re.test('I have 5 cucumbers')).toBe(true);
    expect(re.test('I have -3 cucumbers')).toBe(true);
    expect(re.test('I have abc cucumbers')).toBe(false);
  });

  it('converts {string}', () => {
    const re = cucumberExpressionToRegex('the user is {string}');
    expect(re.test('the user is "admin"')).toBe(true);
    expect(re.test("the user is 'admin'")).toBe(true);
    expect(re.test('the user is admin')).toBe(false);
  });

  it('converts {word}', () => {
    const re = cucumberExpressionToRegex('I am a {word} user');
    expect(re.test('I am a happy user')).toBe(true);
    expect(re.test('I am a  user')).toBe(false);
  });

  it('converts {}', () => {
    const re = cucumberExpressionToRegex('I see {}');
    expect(re.test('I see anything at all')).toBe(true);
  });

  it('escapes literal dots and parens', () => {
    const re = cucumberExpressionToRegex('price is {float} USD');
    expect(re.test('price is 3.14 USD')).toBe(true);
    expect(re.test('price is 3X14 USD')).toBe(false);
  });
});
