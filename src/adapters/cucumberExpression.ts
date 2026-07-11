const TYPE_PATTERNS: Record<string, string> = {
  int: '-?\\d+',
  float: '-?\\d*\\.?\\d+',
  word: '[^\\s]+',
  string: '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'',
  bigdecimal: '-?\\d*\\.?\\d+',
  double: '-?\\d*\\.?\\d+',
  long: '-?\\d+',
  short: '-?\\d+',
  byte: '-?\\d+',
  '': '[^,]+',
};

export function isCucumberExpression(pattern: string): boolean {
  if (pattern.startsWith('^') || pattern.endsWith('$')) {
    return false;
  }
  // {Type} parameter, or the anonymous {} parameter
  if (/\{[a-zA-Z]\w*\}|\{\}/.test(pattern)) {
    return true;
  }
  // (optional) text group
  if (/\([^)]+\)/.test(pattern)) {
    return true;
  }
  return false;
}

export function cucumberExpressionToRegex(pattern: string): RegExp {
  // Tokenize into: {type} parameters, (optional) groups, and literal chunks
  const TOKEN_RE = /(\{[\w]*\}|\([^)]*\))/g;
  const segments: string[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(pattern)) !== null) {
    if (m.index > lastIndex) {
      segments.push(literalToRegex(pattern.slice(lastIndex, m.index)));
    }
    const token = m[0];
    if (token.startsWith('{')) {
      const type = token.slice(1, -1);
      segments.push(`(${TYPE_PATTERNS[type] ?? '[^,]+'})`);
    } else {
      // (optional text) → (?:text)?
      const inner = token.slice(1, -1).replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
      segments.push(`(?:${inner})?`);
    }
    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < pattern.length) {
    segments.push(literalToRegex(pattern.slice(lastIndex)));
  }

  return new RegExp(`^${segments.join('')}$`);
}

function literalToRegex(text: string): string {
  // Handle word/word alternation (e.g. "cucumber/banana") before escaping
  const parts = text.split(/(\b\w+\/\w+\b)/);
  return parts
    .map((part) => {
      const slash = part.indexOf('/');
      if (slash > 0 && /^\w+\/\w+$/.test(part)) {
        const a = part.slice(0, slash).replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
        const b = part.slice(slash + 1).replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
        return `(?:${a}|${b})`;
      }
      return part.replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
    })
    .join('');
}
