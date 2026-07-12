const stepKeywordRegex = /^\s*(Given|When|Then|And|But)\s+(.+)\s*$/;
const blockHeaderRegex = /^(Feature|Rule|Background|Scenario Outline|Scenario|Example|Examples)\b.*:/;

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

export type StepKeyword = 'Given' | 'When' | 'Then';

/**
 * Returns the effective Given/When/Then keyword for a step line plus its body.
 * `And`/`But` inherit the nearest governing Given/When/Then above them; a leading
 * And/But with nothing above defaults to `Given`. Returns undefined for
 * non-step lines (comments, blank, feature/scenario headers).
 */
export function getStepKeywordAtLine(
  documentText: string,
  zeroBasedLine: number,
): { keyword: StepKeyword; body: string } | undefined {
  const lines = documentText.split(/\r?\n/);
  if (zeroBasedLine < 0 || zeroBasedLine >= lines.length) {
    return undefined;
  }

  const here = lines[zeroBasedLine].trim().match(stepKeywordRegex);
  if (!here) {
    return undefined;
  }

  const rawKeyword = here[1];
  const body = here[2].trim();

  if (rawKeyword === 'Given' || rawKeyword === 'When' || rawKeyword === 'Then') {
    return { keyword: rawKeyword, body };
  }

  // And / But: scan upward for the governing keyword, stopping at scenario boundaries.
  for (let i = zeroBasedLine - 1; i >= 0; i--) {
    const trimmedLine = lines[i].trim();
    if (blockHeaderRegex.test(trimmedLine)) {
      break;
    }
    const m = trimmedLine.match(stepKeywordRegex);
    if (!m) {
      continue;
    }
    const kw = m[1];
    if (kw === 'Given' || kw === 'When' || kw === 'Then') {
      return { keyword: kw, body };
    }
  }

  return { keyword: 'Given', body };
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
