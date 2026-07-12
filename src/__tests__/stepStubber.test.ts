import { describe, it, expect } from 'vitest';
import {
  inferPattern,
  deriveIdentifierWords,
  toSnake,
  toLowerCamel,
  toUpperCamel,
} from '../stepStubber';

describe('inferPattern', () => {
  it('maps quoted strings, integers and floats to typed placeholders', () => {
    const r = inferPattern('the user enters "admin" and 3 codes');
    expect(r.cucumber).toBe('the user enters {string} and {int} codes');
    expect(r.goRegex).toBe('^the user enters "([^"]*)" and (\\d+) codes$');
    expect(r.paramTypes).toEqual(['string', 'int']);
  });

  it('detects floats before ints', () => {
    const r = inferPattern('deposit 3.50 dollars');
    expect(r.cucumber).toBe('deposit {float} dollars');
    expect(r.goRegex).toBe('^deposit ([\\d.]+) dollars$');
    expect(r.paramTypes).toEqual(['float']);
  });

  it('escapes cucumber-special and regex-special literal characters', () => {
    const r = inferPattern('the (admin) user');
    expect(r.cucumber).toBe('the \\(admin\\) user');
    expect(r.goRegex).toBe('^the \\(admin\\) user$');
    expect(r.paramTypes).toEqual([]);
  });
});

describe('identifier helpers', () => {
  it('derives lowercased words, ignoring quoted literals', () => {
    expect(deriveIdentifierWords('the user enters "admin"')).toEqual(['the', 'user', 'enters']);
  });

  it('falls back to ["step"] when nothing usable remains', () => {
    expect(deriveIdentifierWords('"x" 42')).toEqual(['step']);
  });

  it('cases words', () => {
    const w = ['the', 'user', 'logs', 'in'];
    expect(toSnake(w)).toBe('the_user_logs_in');
    expect(toLowerCamel(w)).toBe('theUserLogsIn');
    expect(toUpperCamel(w)).toBe('TheUserLogsIn');
  });
});
