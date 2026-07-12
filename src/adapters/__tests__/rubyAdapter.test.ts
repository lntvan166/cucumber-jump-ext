import { describe, it, expect } from 'vitest';
import { parseRubyStepDefinitions, rubyAdapter } from '../rubyAdapter';

describe('parseRubyStepDefinitions', () => {
  it('parses single-quoted step', () => {
    const content = "Given('I have {int} cucumbers') do |n|\nend";
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('I have {int} cucumbers');
    expect(defs[0].patternLine).toBe(0);
  });

  it('parses double-quoted step', () => {
    const content = 'When("the user logs in") do\nend';
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('the user logs in');
  });

  it('parses regex step', () => {
    const content = 'Then(/^I should see (\\d+) results$/) do |n|\nend';
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe('^I should see (\\d+) results$');
  });

  it('parses multiple steps', () => {
    const content = "Given('step one') do\nend\nWhen('step two') do\nend";
    expect(parseRubyStepDefinitions(content)).toHaveLength(2);
  });

  it('ignores non-step lines', () => {
    expect(parseRubyStepDefinitions('def some_helper\nend')).toHaveLength(0);
  });
});

describe('rubyAdapter.matchesStep', () => {
  const makeDef = (pattern: string) => ({
    pattern, patternLine: 0, patternStartCol: 0, patternEndCol: pattern.length,
  });

  it('matches Cucumber Expression', () => {
    expect(rubyAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('matches regex', () => {
    expect(rubyAdapter.matchesStep(makeDef('^I have (\\d+) cucumbers$'), 'I have 5 cucumbers', 'i have 5 cucumbers')).toBe(true);
  });

  it('does not match different step', () => {
    expect(rubyAdapter.matchesStep(makeDef('I have {int} cucumbers'), 'I eat 5 cucumbers', 'i eat 5 cucumbers')).toBe(false);
  });

  it('does not match a step that only contains the pattern as substring', () => {
    const def = { pattern: 'the user logs in', patternLine: 0, patternStartCol: 0, patternEndCol: 16 };
    expect(rubyAdapter.matchesStep(def, 'the user logs in to admin', 'the user logs in to admin')).toBe(false);
  });
});

describe('rubyAdapter escaped quotes', () => {
  it("unescapes \\' inside single-quoted patterns", () => {
    // Ruby source: Given('I can\'t stop') do
    const content = "Given('I can\\'t stop') do";
    const defs = parseRubyStepDefinitions(content);
    expect(defs).toHaveLength(1);
    expect(defs[0].pattern).toBe("I can't stop");
    expect(rubyAdapter.matchesStep(defs[0], "I can't stop", "i can't stop")).toBe(true);
  });
});

describe('rubyAdapter.stubTemplate', () => {
  const t = rubyAdapter.stubTemplate!;
  it('renders a block with args', () => {
    expect(t.render({ keyword: 'When', stepBody: 'the user enters "admin"', ext: 'rb' })).toBe(
      ["When('the user enters {string}') do |arg1|", '  pending', 'end'].join('\n'),
    );
  });
  it('renders a block without args', () => {
    expect(t.render({ keyword: 'Given', stepBody: 'the user is logged in', ext: 'rb' })).toBe(
      ["Given('the user is logged in') do", '  pending', 'end'].join('\n'),
    );
  });
});
