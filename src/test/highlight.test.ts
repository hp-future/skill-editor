import { describe, expect, it } from 'vitest';
import {
  highlight,
  languageForPath,
  resolveLanguage,
  supportedLanguages,
} from '../lib/highlight';

/** Concatenating token values must always reproduce the input exactly. */
const joined = (source: string, language: string): string =>
  highlight(source, language)
    .tokens.map((token) => token.value)
    .join('');

const typesOf = (source: string, language: string): string[] =>
  highlight(source, language).tokens.map((token) => token.type);

const only = (source: string, language: string, type: string): string[] =>
  highlight(source, language)
    .tokens.filter((token) => token.type === type)
    .map((token) => token.value);

describe('resolveLanguage', () => {
  it('maps aliases to canonical ids', () => {
    expect(resolveLanguage('ts')).toBe('scriptType');
    expect(resolveLanguage('TSX')).toBe('scriptType');
    expect(resolveLanguage('yml')).toBe('yaml');
    expect(resolveLanguage('bash')).toBe('shell');
    expect(resolveLanguage('markdown')).toBe('markdown');
    expect(resolveLanguage('ps1')).toBe('powershell');
  });

  it('returns null for unknown or empty labels', () => {
    expect(resolveLanguage('brainfuck')).toBeNull();
    expect(resolveLanguage('')).toBeNull();
    expect(resolveLanguage(null)).toBeNull();
  });

  it('accepts canonical ids, not only fence aliases', () => {
    // `languageForPath` hands back ids like `scriptType`; they must resolve
    // through the same path as the `ts` alias.
    for (const id of supportedLanguages()) {
      expect(resolveLanguage(id)).toBe(id);
      expect(resolveLanguage(id.toUpperCase())).toBe(id);
    }
    expect(resolveLanguage('scriptType')).toBe('scriptType');
    expect(resolveLanguage('shell')).toBe('shell');
  });

  it('lists the supported languages', () => {
    expect(supportedLanguages()).toContain('json');
    expect(supportedLanguages()).toContain('python');
    expect(supportedLanguages()).toContain('go');
  });
});

describe('languageForPath', () => {
  it('detects the languages a skill package actually ships', () => {
    expect(languageForPath('scripts/run.ts')).toBe('scriptType');
    expect(languageForPath('scripts/run.tsx')).toBe('scriptType');
    expect(languageForPath('scripts/install.sh')).toBe('shell');
    expect(languageForPath('scripts/install.bash')).toBe('shell');
    expect(languageForPath('scripts/run.ps1')).toBe('powershell');
    expect(languageForPath('agents/run.py')).toBe('python');
    expect(languageForPath('assets/site.css')).toBe('css');
    expect(languageForPath('data/records.json')).toBe('json');
    expect(languageForPath('SKILL.md')).toBe('markdown');
  });

  it('is case-insensitive and ignores dots in directory names', () => {
    expect(languageForPath('scripts/Build.TS')).toBe('scriptType');
    expect(languageForPath('v1.2/setup.sh')).toBe('shell');
  });

  it('returns null when there is nothing to highlight with', () => {
    expect(languageForPath('LICENSE')).toBeNull();
    expect(languageForPath('Makefile')).toBeNull();
    expect(languageForPath('archive.')).toBeNull();
    expect(languageForPath('assets/logo.png')).toBeNull();
    expect(languageForPath('data/records.xyz')).toBeNull();
  });

  it('maps plain text files to the text rule set', () => {
    expect(languageForPath('notes/readme.txt')).toBe('text');
    // Resolving a language must still leave plain text uncoloured.
    expect(highlight('a -> b', languageForPath('notes/readme.txt')).tokens).toEqual([
      { type: 'plain', value: 'a -> b' },
    ]);
  });
});

describe('highlight', () => {
  it('preserves the source exactly (round-trip)', () => {
    const samples: [string, string][] = [
      ['const x = "a\nb"; // c\n', 'ts'],
      ['{"a": [1, 2, true, null]}\n', 'json'],
      ['def f(a):\n    return a  # comment\n', 'python'],
      ['name: value # note\nlist:\n  - 1\n', 'yaml'],
      ['echo "$HOME" | grep x\n', 'sh'],
      ['SELECT id FROM t WHERE a = 1;', 'sql'],
      ['<a href="x">text</a>', 'html'],
      ['未知语言的内容 *** ', 'klingon'],
      ['', 'json'],
    ];
    for (const [source, language] of samples) {
      expect(joined(source, language)).toBe(source);
    }
  });

  it('classifies JSON properties, strings, numbers and literals', () => {
    const source = '{"a": 1, "b": [true, null]}';
    expect(only(source, 'json', 'property')).toEqual(['"a"', '"b"']);
    expect(only(source, 'json', 'number')).toEqual(['1']);
    expect(only(source, 'json', 'keyword')).toEqual(['true', 'null']);
    expect(typesOf(source, 'json')).toContain('punctuation');
  });

  it('classifies Go keywords, strings and comments', () => {
    const source = 'func main() {\n\tmsg := "hi" // greeting\n\treturn\n}';
    expect(only(source, 'go', 'keyword')).toEqual(['func', 'return']);
    expect(only(source, 'go', 'string')).toEqual(['"hi"']);
    expect(only(source, 'go', 'comment')).toEqual(['// greeting']);
    expect(only(source, 'go', 'function')).toEqual(['main']);
  });

  it('classifies Python keywords, builtins, decorators and comments', () => {
    const source = '@decorator\ndef run(items):\n    """doc"""\n    return [x for x in items]  # loop\n';
    expect(only(source, 'python', 'keyword')).toEqual(['def', 'return', 'for', 'in']);
    expect(only(source, 'python', 'string')).toEqual(['"""doc"""']);
    expect(only(source, 'python', 'comment')).toEqual(['# loop']);
    expect(only(source, 'python', 'builtin')).toEqual([]);
  });

  it('classifies YAML keys, comments and scalars', () => {
    const source = '# top\nname: demo\ncount: 12\nenabled: true\n';
    expect(only(source, 'yaml', 'comment')).toEqual(['# top']);
    expect(only(source, 'yaml', 'property')).toEqual(['name', 'count', 'enabled']);
    expect(only(source, 'yaml', 'number')).toEqual(['12']);
    expect(only(source, 'yaml', 'keyword')).toEqual(['true']);
  });

  it('classifies shell strings, variables and keywords', () => {
    const source = '#!/bin/sh\necho "hi $USER" # greet\nif [ -f $HOME/x ]; then ls; fi\n';
    // Everything inside double quotes is a single string token.
    expect(only(source, 'sh', 'string')).toEqual(['"hi $USER"']);
    // Bare expansions outside quotes are variables.
    expect(only(source, 'sh', 'builtin')).toEqual(['$HOME']);
    expect(only(source, 'sh', 'comment')).toEqual(['#!/bin/sh', '# greet']);
    expect(only(source, 'sh', 'keyword')).toEqual(['if', 'then', 'fi']);
  });

  it('classifies SQL keywords and functions', () => {
    const source = "SELECT count(*) FROM t WHERE name = 'x' -- note";
    const keywords = only(source, 'sql', 'keyword').map((value) => value.toUpperCase());
    expect(keywords).toEqual(['SELECT', 'FROM', 'WHERE']);
    // Built-in aggregates read as calls, not as keywords.
    expect(only(source, 'sql', 'function')).toEqual(['count']);
    expect(only(source, 'sql', 'string')).toEqual(["'x'"]);
    expect(only(source, 'sql', 'comment')).toEqual(['-- note']);
  });

  it('classifies HTML tags and attributes', () => {
    const source = '<div class="a" id="b">text</div>';
    expect(only(source, 'html', 'tag')).toEqual(['<div', '</div']);
    expect(only(source, 'html', 'attribute')).toEqual(['class', 'id']);
    expect(only(source, 'html', 'string')).toEqual(['"a"', '"b"']);
  });

  it('classifies Markdown fences and emphasis', () => {
    const source = '# Title\n\n**bold** and `code`\n\n- item\n';
    expect(only(source, 'markdown', 'type')).toEqual(['# Title']);
    expect(only(source, 'markdown', 'keyword')).toEqual(['**bold**']);
    expect(only(source, 'markdown', 'string')).toEqual(['`code`']);
  });

  it('does not treat markers inside strings as comments', () => {
    const source = 'const url = "https://example.com/a#b"; // real comment\n';
    const comments = only(source, 'ts', 'comment');
    expect(comments).toEqual(['// real comment']);
    expect(only(source, 'ts', 'string')).toEqual(['"https://example.com/a#b"']);
  });

  it('handles multi-line constructs and unterminated input', () => {
    const block = '/* line one\n line two */\nconst a = 1;\n';
    expect(only(block, 'ts', 'comment')).toEqual(['/* line one\n line two */']);

    const template = 'const q = `a\n${b}\nc`;\n';
    expect(only(template, 'ts', 'string')).toEqual(['`a\n${b}\nc`']);

    // An unterminated string still round-trips and does not loop forever.
    expect(joined('const bad = "unterminated', 'ts')).toBe('const bad = "unterminated');
  });

  it('falls back to a single plain token for unknown languages', () => {
    const result = highlight('some `code` here', 'klingon');
    expect(result.language).toBeNull();
    expect(result.tokens).toEqual([{ type: 'plain', value: 'some `code` here' }]);
  });

  it('treats text and empty input as plain', () => {
    expect(highlight('a: 1', 'text').tokens).toEqual([{ type: 'plain', value: 'a: 1' }]);
    expect(highlight('', 'json').tokens).toEqual([]);
  });

  it('classifies diffs line by line', () => {
    const source = '@@ -1 +1 @@\n-old\n+new\n';
    expect(only(source, 'diff', 'comment')).toEqual(['@@ -1 +1 @@']);
    expect(only(source, 'diff', 'keyword')).toEqual(['-old']);
    expect(only(source, 'diff', 'type')).toEqual(['+new']);
  });
});
