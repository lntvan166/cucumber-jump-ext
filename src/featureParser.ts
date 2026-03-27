const stepKeywordRegex = /^\s*(Given|When|Then|And|But)\s+(.+)\s*$/;

/** True if `fsPath` is a `.feature` file (case-insensitive extension). */
export function isFeatureFilePath(fsPath: string): boolean {
  return fsPath.toLowerCase().endsWith(".feature");
}

/** True for `.feature` paths; uses {@link Uri.path} when `fsPath` is empty (e.g. some virtual URIs). */
export function isFeatureUri(uri: { fsPath: string; path: string }): boolean {
  if (isFeatureFilePath(uri.fsPath)) {
    return true;
  }

  return uri.path.toLowerCase().endsWith(".feature");
}

export function normalizeStepText(raw: string): string {
  const trimmed = raw.trim();
  const kw = trimmed.match(stepKeywordRegex);
  const body = kw ? kw[2].trim() : trimmed;

  return body.replace(/\s+/g, " ").toLowerCase();
}

export function parseStepLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.length === 0) {
    return undefined;
  }

  const kw = trimmed.match(stepKeywordRegex);
  if (!kw) {
    return undefined;
  }

  return kw[2].trim();
}

export function getStepTextAtLineNumber(documentText: string, zeroBasedLine: number): string | undefined {
  const lines = documentText.split(/\r?\n/);
  if (zeroBasedLine < 0 || zeroBasedLine >= lines.length) {
    return undefined;
  }

  return parseStepLine(lines[zeroBasedLine]);
}

/**
 * Line index of the nearest Gherkin step (Given/When/Then/And/But) to `zeroBasedLine`:
 * same line if it is a step, else closest line above, else closest below.
 */
export function findNearestStepLineIndex(documentText: string, zeroBasedLine: number): number | undefined {
  const lines = documentText.split(/\r?\n/);
  if (lines.length === 0) {
    return undefined;
  }

  if (getStepTextAtLineNumber(documentText, zeroBasedLine)) {
    return zeroBasedLine;
  }

  for (let i = zeroBasedLine - 1; i >= 0; i--) {
    if (getStepTextAtLineNumber(documentText, i)) {
      return i;
    }
  }

  for (let i = zeroBasedLine + 1; i < lines.length; i++) {
    if (getStepTextAtLineNumber(documentText, i)) {
      return i;
    }
  }

  return undefined;
}
