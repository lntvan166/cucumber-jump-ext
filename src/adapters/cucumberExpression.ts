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
  return /\{[a-zA-Z]\w*\}/.test(pattern);
}

export function cucumberExpressionToRegex(pattern: string): RegExp {
  const tokens = pattern.split(/(\{[\w]*\})/);
  const regexStr = tokens
    .map((token) => {
      if (/^\{[\w]*\}$/.test(token)) {
        const type = token.slice(1, -1);
        return `(${TYPE_PATTERNS[type] ?? '[^,]+'})`;
      }
      return token.replace(/[.*+?^$|{}[\]\\()]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${regexStr}$`);
}
