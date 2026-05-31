import type { LanguageAdapter } from './languageAdapter';
import { goAdapter } from './adapters/goAdapter';
import { javaAdapter } from './adapters/javaAdapter';
import { pythonAdapter } from './adapters/pythonAdapter';
import { jsAdapter } from './adapters/jsAdapter';
import { rubyAdapter } from './adapters/rubyAdapter';
import { csharpAdapter } from './adapters/csharpAdapter';
import { dartAdapter } from './adapters/dartAdapter';

const EXT_MAP: Record<string, LanguageAdapter> = {
  go: goAdapter,
  java: javaAdapter,
  kt: javaAdapter,
  py: pythonAdapter,
  ts: jsAdapter,
  js: jsAdapter,
  rb: rubyAdapter,
  cs: csharpAdapter,
  dart: dartAdapter,
};

/**
 * Returns the adapter for the given stepsGlob pattern by inspecting its file extension.
 * Examples: "**\/*Steps.java" → javaAdapter, "**\/*_steps.go" → goAdapter
 * Falls back to goAdapter for unknown extensions.
 */
export function getAdapterForGlob(stepsGlob: string): LanguageAdapter {
  const m = stepsGlob.match(/\.([a-zA-Z]+)(?:[^a-zA-Z]|$)/);
  const ext = m ? m[1].toLowerCase() : '';
  return EXT_MAP[ext] ?? goAdapter;
}

/**
 * Returns the adapter for a file by its extension (used for reverse navigation).
 */
export function getAdapterForUri(uri: { fsPath: string }): LanguageAdapter {
  const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? goAdapter;
}
