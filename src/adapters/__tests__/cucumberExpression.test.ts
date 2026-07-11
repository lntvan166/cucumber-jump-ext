import { describe, it, expect } from 'vitest';
import { cucumberExpressionToRegex, isCucumberExpression } from '../cucumberExpression';

describe('isCucumberExpression', () => {
  it('returns true for {int}', () => expect(isCucumberExpression('I have {int} cucumbers')).toBe(true));
  it('returns false for plain regex', () => expect(isCucumberExpression('^I have (\\d+) cucumbers$')).toBe(false));
  it('returns false for regex with quantifier braces', () => {
    expect(isCucumberExpression('^\\d{3}$')).toBe(false);
  });
  it('returns false for anchored regex', () => {
    expect(isCucumberExpression('^I have (\\d+) cucumbers$')).toBe(false);
    expect(isCucumberExpression('I have (\\d+) cucumbers$')).toBe(false);
  });
  it('returns false for unanchored regex with numeric quantifier', () => {
    expect(isCucumberExpression('there are \\d{3} items')).toBe(false);
    expect(isCucumberExpression('price is \\d{1,3}\\.\\d{2}')).toBe(false);
  });
  it('returns true for the anonymous {} parameter', () => {
    expect(isCucumberExpression('I see {}')).toBe(true);
  });
  it('returns true for optional text group', () => {
    expect(isCucumberExpression('I have {int} cucumber(s)')).toBe(true);
    expect(isCucumberExpression('the button is (not )?visible')).toBe(true);
  });
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

  it('escapes literal pipe character', () => {
    const re = cucumberExpressionToRegex('answer is yes|no');
    expect(re.test('answer is yes|no')).toBe(true);
    expect(re.test('yes')).toBe(false);
    expect(re.test('no')).toBe(false);
  });

  it('supports optional text with (s)', () => {
    const re = cucumberExpressionToRegex('I have {int} cucumber(s)');
    expect(re.test('I have 5 cucumber')).toBe(true);
    expect(re.test('I have 5 cucumbers')).toBe(true);
    expect(re.test('I have 5 cucumberx')).toBe(false);
  });

  it('supports alternation with /', () => {
    const re = cucumberExpressionToRegex('I have {int} cucumber/banana');
    expect(re.test('I have 5 cucumber')).toBe(true);
    expect(re.test('I have 5 banana')).toBe(true);
    expect(re.test('I have 5 apple')).toBe(false);
  });

  it('supports optional text without parameter', () => {
    const re = cucumberExpressionToRegex('the button is (not )visible');
    expect(re.test('the button is visible')).toBe(true);
    expect(re.test('the button is not visible')).toBe(true);
    expect(re.test('the button is maybe visible')).toBe(false);
  });
});
