import { normalizeStepText } from "./featureParser";

export type BddStepBlock = {
  commentText: string | undefined;
  regexPattern: string;
  regexLine: number;
  regexStartColumn: number;
  regexEndColumn: number;
  implFunctionName: string | undefined;
  implLine: number | undefined;
};

const stepKeyRegex = /`([^`]+)`\s*:\s*func/;
const lineCommentRegex = /^\s*\/\/\s*(.+?)\s*$/;
const fullLineDoubleSlashCommentRegex = /^\s*\/\//;
const returnStateRegex = /return\s+([a-zA-Z0-9_]+)\s*\(\s*state/;

export function parseBddFile(content: string): BddStepBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: BddStepBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = line.match(stepKeyRegex);
    if (!keyMatch) {
      continue;
    }

    const regexPattern = keyMatch[1];
    const tickIdx = line.indexOf("`");
    const endTick = line.indexOf("`", tickIdx + 1);
    const regexLine = i;
    const regexStartColumn = tickIdx >= 0 ? tickIdx : 0;
    const regexEndColumn = endTick >= 0 ? endTick + 1 : line.length;

    let commentText: string | undefined;
    if (i > 0) {
      const prev = lines[i - 1].match(lineCommentRegex);
      if (prev) {
        commentText = prev[1].trim();
      }
    }

    let implFunctionName: string | undefined;
    let implLine: number | undefined;
    const blockEndLine = findBlockEndLine(lines, i);

    for (let j = i + 1; j <= blockEndLine; j++) {
      const bodyLine = lines[j];
      if (fullLineDoubleSlashCommentRegex.test(bodyLine)) {
        continue;
      }

      const ret = bodyLine.match(returnStateRegex);
      if (ret) {
        implFunctionName = ret[1];
        implLine = j;
        break;
      }
    }

    blocks.push({
      commentText,
      regexPattern,
      regexLine,
      regexStartColumn,
      regexEndColumn,
      implFunctionName,
      implLine,
    });
  }

  return blocks;
}

export function findBlockAtPosition(
  content: string,
  line: number,
  _character: number,
): BddStepBlock | undefined {
  const blocks = parseBddFile(content);
  const lines = content.split(/\r?\n/);

  for (const block of blocks) {
    if (line < block.regexLine - 1) {
      continue;
    }

    const blockEndLine = findBlockEndLine(lines, block.regexLine);
    if (line > blockEndLine) {
      continue;
    }

    if (line === block.regexLine - 1) {
      const prevLine = lines[block.regexLine - 1] ?? "";
      const prevMatch = prevLine.match(lineCommentRegex);
      if (prevMatch) {
        return block;
      }
    }

    if (line === block.regexLine) {
      return block;
    }

    if (line > block.regexLine && line <= blockEndLine) {
      return block;
    }
  }

  return undefined;
}

/**
 * True when the cursor is on the `//` comment above a step key or on the regex key line itself
 * (not inside the `func() error { ... }` body). Used so Go to Definition can jump to `.feature`
 * on those lines while leaving the step body to gopls only.
 */
export function isBddStepDeclarationPosition(
  content: string,
  line: number,
  character: number,
): boolean {
  const block = findBlockAtPosition(content, line, character);
  if (!block) {
    return false;
  }

  return line === block.regexLine || line === block.regexLine - 1;
}

function findBlockEndLine(lines: string[], regexLine: number): number {
  let depth = 0;
  let started = false;

  for (let i = regexLine; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        started = true;
      }
      if (ch === "}") {
        depth -= 1;
      }
    }

    if (started && depth === 0) {
      return i;
    }
  }

  return lines.length - 1;
}

export function stepTextFromBlock(block: BddStepBlock): string {
  if (block.commentText && block.commentText.length > 0) {
    return block.commentText;
  }

  return humanizeRegexPattern(block.regexPattern);
}

export function blockMatchesNormalizedStep(block: BddStepBlock, normalizedStep: string): boolean {
  return normalizeStepText(stepTextFromBlock(block)) === normalizedStep;
}

export function regexMatchesRawStep(goPattern: string, rawStepBody: string): boolean {
  const body = rawStepBody.trim();
  if (!body) {
    return false;
  }

  try {
    return new RegExp(goPattern).test(body);
  } catch {
    return false;
  }
}

export function blockMatchesStep(block: BddStepBlock, rawStepBody: string, normalizedStep: string): boolean {
  if (blockMatchesNormalizedStep(block, normalizedStep)) {
    return true;
  }

  return regexMatchesRawStep(block.regexPattern, rawStepBody);
}

function humanizeRegexPattern(pattern: string): string {
  let s = pattern;
  if (s.startsWith("^")) {
    s = s.slice(1);
  }
  if (s.endsWith("$")) {
    s = s.slice(0, -1);
  }

  return s.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\./g, ".").replace(/\\"/g, '"');
}
