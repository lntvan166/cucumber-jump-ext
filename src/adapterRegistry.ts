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

/** Every file extension a language adapter exists for (used by the workspace scanner). */
export const KNOWN_STEP_EXTENSIONS: string[] = Object.keys(EXT_MAP);

/**
 * Extracts candidate file extensions from a stepsGlob: the text after the LAST
 * dot of the last path segment, with `{a,b}` brace groups expanded.
 * Examples: "**\/*.steps.ts" → ["ts"], "e2e/**\/*.{js,ts}" → ["js","ts"],
 * "**\/steps/**" → [].
 */
export function extensionsForGlob(stepsGlob: string): string[] {
  const lastSegment = stepsGlob.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot === -1) {
    return [];
  }
  const rawExt = lastSegment.slice(dot + 1);
  const brace = rawExt.match(/^\{([^}]*)\}$/);
  const candidates = brace ? brace[1].split(',') : [rawExt];
  return candidates
    .map((e) => e.trim().replace(/^\./, '').toLowerCase())
    .filter((e) => /^[a-z0-9]+$/.test(e));
}

/**
 * Returns the adapter for the given stepsGlob pattern by inspecting its file
 * extension(s). Returns undefined when no extension is detectable, the
 * extension is unknown, or a brace glob mixes different languages — callers
 * must surface that loudly instead of guessing.
 */
export function getAdapterForGlob(stepsGlob: string): LanguageAdapter | undefined {
  const adapters = new Set(
    extensionsForGlob(stepsGlob)
      .map((ext) => EXT_MAP[ext])
      .filter((a): a is LanguageAdapter => a !== undefined),
  );
  return adapters.size === 1 ? [...adapters][0] : undefined;
}

/**
 * Returns the adapter for a file by its extension (used for reverse navigation).
 */
export function getAdapterForUri(uri: { fsPath: string }): LanguageAdapter | undefined {
  const ext = uri.fsPath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext];
}
