import { describe, it, expect } from 'vitest';
import { getAdapterForGlob, getAdapterForUri, extensionsForGlob } from '../adapterRegistry';
import { goAdapter } from '../adapters/goAdapter';
import { javaAdapter } from '../adapters/javaAdapter';
import { jsAdapter } from '../adapters/jsAdapter';
import { pythonAdapter } from '../adapters/pythonAdapter';

describe('extensionsForGlob', () => {
  it('takes the extension after the LAST dot of the last segment', () => {
    expect(extensionsForGlob('**/*.steps.ts')).toEqual(['ts']);
  });

  it('expands brace groups', () => {
    expect(extensionsForGlob('e2e/**/*.{js,ts}')).toEqual(['js', 'ts']);
  });

  it('ignores dots in directory names', () => {
    expect(extensionsForGlob('src/test.resources/**/*.java')).toEqual(['java']);
  });

  it('returns empty for extensionless globs', () => {
    expect(extensionsForGlob('**/steps/**')).toEqual([]);
  });
});

describe('getAdapterForGlob', () => {
  it('resolves simple extensions', () => {
    expect(getAdapterForGlob('**/*_steps.go')).toBe(goAdapter);
    expect(getAdapterForGlob('**/*Steps.java')).toBe(javaAdapter);
    expect(getAdapterForGlob('features/steps/**/*.py')).toBe(pythonAdapter);
  });

  it('resolves double-extension step files (cucumber-js convention)', () => {
    expect(getAdapterForGlob('features/**/*.steps.ts')).toBe(jsAdapter);
  });

  it('resolves brace globs when all extensions share one adapter', () => {
    expect(getAdapterForGlob('e2e/**/*.{js,ts}')).toBe(jsAdapter);
  });

  it('returns undefined for extensionless globs instead of silently using Go', () => {
    expect(getAdapterForGlob('**/steps/**')).toBeUndefined();
  });

  it('returns undefined for unknown extensions', () => {
    expect(getAdapterForGlob('**/*.exs')).toBeUndefined();
  });

  it('returns undefined for brace globs mixing different languages', () => {
    expect(getAdapterForGlob('**/*.{go,java}')).toBeUndefined();
  });
});

describe('getAdapterForUri', () => {
  it('uses the last extension of the file path', () => {
    expect(getAdapterForUri({ fsPath: '/a/b/login.steps.ts' })).toBe(jsAdapter);
    expect(getAdapterForUri({ fsPath: '/a/b/steps_test.go' })).toBe(goAdapter);
  });

  it('returns undefined for unknown extensions', () => {
    expect(getAdapterForUri({ fsPath: '/a/b/readme.md' })).toBeUndefined();
  });
});
