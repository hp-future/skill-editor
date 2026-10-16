/**
 * Small, dependency-free syntax highlighter for fenced code blocks.
 *
 * Scope: it is a *lexer*, not a parser. Each language is described by an
 * ordered rule list, and the scanner picks whichever rule matches earliest at
 * the current offset (longest match wins ties). That ordering is what makes
 * `// comment` inside a string stay a string, and `#` a comment in Python but
 * not in CSS.
 *
 * Unknown languages simply produce a single plain token, so fenced blocks are
 * never dropped or mangled.
 */

export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'function'
  | 'type'
  | 'property'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attribute';

export interface Token {
  readonly type: TokenType;
  readonly value: string;
}

export interface HighlightResult {
  /** Tokens in source order; concatenating their values reproduces the input. */
  readonly tokens: readonly Token[];
  /** Canonical language id that was used, or `null` for plain text. */
  readonly language: string | null;
}

interface Rule {
  readonly type: TokenType;
  readonly pattern: RegExp;
}

/* ------------------------------- languages ------------------------------ */

const C_KEYWORDS =
  'abstract|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|final|finally|for|from|function|get|goto|if|implements|import|in|instanceof|interface|is|let|namespace|new|of|package|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield';

const TS_TYPES =
  'any|bigint|boolean|never|null|number|object|string|symbol|undefined|unknown|void';

/** Rules shared by the JavaScript/TypeScript family. */
function scriptRules(extraKeywords = ''): Rule[] {
  const keywords = extraKeywords ? `${C_KEYWORDS}|${extraKeywords}` : C_KEYWORDS;
  return [
    { type: 'comment', pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/ },
    { type: 'string', pattern: /`(?:\\[\s\S]|\$\{[^}]*\}|[^\\`])*`/ },
    { type: 'string', pattern: /"(?:\\[\s\S]|[^\\"\n])*"|'(?:\\[\s\S]|[^\\'\n])*'/ },
    { type: 'number', pattern: /0[xXbBoO][0-9a-fA-F_]+n?|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?/ },
    { type: 'keyword', pattern: new RegExp(`\\b(?:${keywords})\\b`) },
    { type: 'builtin', pattern: new RegExp(`\\b(?:${TS_TYPES})\\b`) },
    { type: 'builtin', pattern: /\b(?:true|false|NaN|Infinity|console|document|window|globalThis|Math|JSON|Object|Array|Promise|Map|Set|Date|RegExp|Error|String|Number|Boolean|Symbol)\b/ },
    { type: 'function', pattern: /[A-Za-z_$][\w$]*(?=\s*\()/ },
    { type: 'type', pattern: /\b[A-Z][\w$]*\b/ },
    { type: 'punctuation', pattern: /[{}[\]();,.:]/ },
    { type: 'operator', pattern: /[+\-*/%=<>!&|^~?]+/ },
  ];
}

const SHELL_KEYWORDS =
  'if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|in|local|export|readonly|exit|break|continue|declare|set|unset|shift|trap|source';

const SQL_KEYWORDS =
  'SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|VIEW|DROP|ALTER|ADD|COLUMN|PRIMARY|FOREIGN|KEY|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|NULL|IS|IN|LIKE|BETWEEN|DISTINCT|UNION|ALL|CASE|WHEN|THEN|ELSE|END|COUNT|SUM|AVG|MIN|MAX|WITH|RETURNING';

const RULES: Record<string, Rule[]> = {
  json: [
    { type: 'property', pattern: /"(?:\\.|[^\\"])*"(?=\s*:)/ },
    { type: 'string', pattern: /"(?:\\.|[^\\"])*"/ },
    { type: 'keyword', pattern: /\b(?:true|false|null)\b/ },
    { type: 'number', pattern: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
    { type: 'punctuation', pattern: /[{}[\],:]/ },
  ],
  script: scriptRules(),
  scriptType: scriptRules('enum|keyof|infer|asserts|override|abstract|readonly'),
  python: [
    { type: 'comment', pattern: /#[^\n]*/ },
    { type: 'string', pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/ },
    { type: 'string', pattern: /[rbfu]{0,2}"(?:\\[\s\S]|[^\\"\n])*"|[rbfu]{0,2}'(?:\\[\s\S]|[^\\'\n])*'/ },
    { type: 'number', pattern: /\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?\b/ },
    {
      type: 'keyword',
      pattern:
        /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\b/,
    },
    { type: 'builtin', pattern: /\b(?:True|False|None|self|cls|print|len|range|str|int|float|list|dict|set|tuple|open|enumerate|zip|isinstance)\b/ },
    { type: 'function', pattern: /[A-Za-z_]\w*(?=\s*\()/ },
    { type: 'type', pattern: /\b[A-Z]\w*\b/ },
    { type: 'punctuation', pattern: /[{}[\]();,.:]/ },
    { type: 'operator', pattern: /[+\-*/%=<>!&|^~@]+/ },
  ],
  shell: [
    { type: 'comment', pattern: /#[^\n]*/ },
    { type: 'string', pattern: /"(?:\\[\s\S]|\$\([^)]*\)|[^\\"])*"|'[^']*'/ },
    { type: 'builtin', pattern: /\$(?:\{[^}]*\}|\w+|[@*#?$!])/ },
    { type: 'keyword', pattern: new RegExp(`\\b(?:${SHELL_KEYWORDS})\\b`) },
    { type: 'operator', pattern: /\|\||&&|>>|>|<|;;|;|&|\|/ },
    { type: 'punctuation', pattern: /[{}[\]()]/ },
  ],
  yaml: [
    { type: 'comment', pattern: /#[^\n]*/ },
    { type: 'string', pattern: /"(?:\\.|[^\\"])*"|'(?:''|[^'])*'/ },
    { type: 'property', pattern: /^[ \t-]*[A-Za-z_][\w.-]*(?=\s*:)/m },
    { type: 'keyword', pattern: /\b(?:true|false|null|yes|no|on|off|~)\b/i },
    { type: 'number', pattern: /\b\d[\d_]*(?:\.\d+)?\b/ },
    { type: 'punctuation', pattern: /^[ \t]*-\s|[:|>]/m },
  ],
  toml: [
    { type: 'comment', pattern: /#[^\n]*/ },
    { type: 'type', pattern: /^\[\[?[^\]\n]+\]\]?/m },
    { type: 'property', pattern: /^\s*[\w.-]+(?=\s*=)/m },
    { type: 'string', pattern: /"""[\s\S]*?"""|"(?:\\.|[^\\"])*"|'[^']*'/ },
    { type: 'keyword', pattern: /\b(?:true|false)\b/ },
    { type: 'number', pattern: /\b\d[\d_]*(?:\.\d+)?\b/ },
  ],
  ini: [
    { type: 'comment', pattern: /[#;][^\n]*/ },
    { type: 'type', pattern: /^\s*\[[^\]\n]+\]/m },
    { type: 'property', pattern: /^\s*[\w.-]+(?=\s*[=:])/m },
    { type: 'keyword', pattern: /\b(?:true|false|yes|no)\b/i },
  ],
  css: [
    { type: 'comment', pattern: /\/\*[\s\S]*?\*\// },
    { type: 'string', pattern: /"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'/ },
    { type: 'type', pattern: /@[\w-]+|::?[\w-]+/ },
    { type: 'property', pattern: /[a-zA-Z-]+(?=\s*:)/ },
    { type: 'number', pattern: /-?\d*\.?\d+(?:%|[a-z]{1,4})?\b/ },
    { type: 'builtin', pattern: /#[0-9a-fA-F]{3,8}\b/ },
    { type: 'punctuation', pattern: /[{}();,]/ },
  ],
  html: [
    { type: 'comment', pattern: /<!--[\s\S]*?-->/ },
    { type: 'tag', pattern: /<\/?[A-Za-z][\w:-]*/ },
    { type: 'string', pattern: /"(?:[^"]*)"|'(?:[^']*)'/ },
    { type: 'attribute', pattern: /[A-Za-z_:][\w:.-]*(?==)/ },
    { type: 'punctuation', pattern: /\/?>/ },
  ],
  markdown: [
    { type: 'string', pattern: /```[\s\S]*?```|`[^`\n]*`/ },
    { type: 'type', pattern: /^#{1,6} .*$/m },
    { type: 'keyword', pattern: /\*\*[^*\n]+\*\*|__[^_\n]+__/ },
    { type: 'builtin', pattern: /\[[^\]\n]*\]\([^)\s]*\)/ },
    { type: 'property', pattern: /^[ \t]*(?:[-*+]|\d+\.)\s/m },
    { type: 'operator', pattern: /^ {0,3}>/m },
  ],
  sql: [
    { type: 'comment', pattern: /--[^\n]*|\/\*[\s\S]*?\*\// },
    { type: 'string', pattern: /'(?:''|[^'])*'/ },
    { type: 'number', pattern: /\b\d+(?:\.\d+)?\b/ },
    { type: 'keyword', pattern: new RegExp(`\\b(?:${SQL_KEYWORDS})\\b`) },
    { type: 'function', pattern: /\b[A-Za-z_]\w*(?=\s*\()/ },
    { type: 'punctuation', pattern: /[;,()*]/ },
  ],
  powershell: [
    { type: 'comment', pattern: /#[^\n]*/ },
    { type: 'string', pattern: /"(?:``|`"|[^"])*"|'[^']*'/ },
    { type: 'builtin', pattern: /\$(?:\{[^}]*\}|\w+)/ },
    { type: 'keyword', pattern: /-(?:eq|ne|gt|ge|lt|le|like|match|notmatch|contains|in|and|or|not)\b/i },
    { type: 'function', pattern: /\b(?:Get|Set|New|Remove|Add|Import|Export|Write|Read|Test|Start|Stop|Select|Where|ForEach|Copy|Move)-[A-Za-z]+\b/ },
    { type: 'operator', pattern: /\|\||&&|\||>|</ },
    { type: 'punctuation', pattern: /[{}[\]()]/ },
  ],
  java: [
    { type: 'comment', pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/ },
    { type: 'string', pattern: /"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'/ },
    { type: 'number', pattern: /\b\d[\d_]*(?:\.\d+)?[fFdDlL]?\b/ },
    { type: 'keyword', pattern: new RegExp(`\\b(?:${C_KEYWORDS}|synchronized|throws|transient|volatile|native|strictfp)\\b`) },
    { type: 'builtin', pattern: /\b(?:String|Integer|Long|Double|Float|Boolean|Object|List|Map|Set|System)\b/ },
    { type: 'function', pattern: /[A-Za-z_]\w*(?=\s*\()/ },
    { type: 'type', pattern: /\b[A-Z]\w*\b/ },
    { type: 'punctuation', pattern: /[{}[\]();,.]/ },
    { type: 'operator', pattern: /[+\-*/%=<>!&|^~?]+/ },
  ],
  go: [
    { type: 'comment', pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n]*/ },
    { type: 'string', pattern: /`[^`]*`|"(?:\\.|[^\\"])*"|'(?:\\.|[^\\'])*'/ },
    { type: 'number', pattern: /\b0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?\b/ },
    { type: 'keyword', pattern: /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/ },
    { type: 'builtin', pattern: /\b(?:bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr|true|false|nil|make|new|len|cap|append|panic|recover)\b/ },
    { type: 'function', pattern: /[A-Za-z_]\w*(?=\s*\()/ },
    { type: 'type', pattern: /\b[A-Z]\w*\b/ },
    { type: 'punctuation', pattern: /[{}[\]();,.]/ },
    { type: 'operator', pattern: /:=|<-|[+\-*/%=<>!&|^]+/ },
  ],
  xml: [
    { type: 'comment', pattern: /<!--[\s\S]*?-->/ },
    { type: 'tag', pattern: /<\/?[A-Za-z][\w:.-]*/ },
    { type: 'string', pattern: /"(?:[^"]*)"|'(?:[^']*)'/ },
    { type: 'attribute', pattern: /[A-Za-z_:][\w:.-]*(?==)/ },
    { type: 'punctuation', pattern: /\/?>/ },
  ],
  diff: [
    { type: 'type', pattern: /^\+.*$/m },
    { type: 'keyword', pattern: /^-.*$/m },
    { type: 'comment', pattern: /^@@.*$/m },
  ],
  text: [],
};

/** Maps common fence labels onto a rule set. */
const LANGUAGE_ALIASES: Record<string, keyof typeof RULES> = {
  js: 'script',
  jsx: 'script',
  javascript: 'script',
  mjs: 'script',
  cjs: 'script',
  node: 'script',
  ts: 'scriptType',
  tsx: 'scriptType',
  typescript: 'scriptType',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  py: 'python',
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'ini',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svg: 'xml',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  ps1: 'powershell',
  powershell: 'powershell',
  pwsh: 'powershell',
  java: 'java',
  kt: 'java',
  cs: 'java',
  c: 'java',
  h: 'java',
  cpp: 'java',
  go: 'go',
  golang: 'go',
  diff: 'diff',
  patch: 'diff',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
};

/* -------------------------------- scanner ------------------------------- */

/** Resolve a fenced-block label to a canonical language id. */
export function resolveLanguage(label: string | null | undefined): keyof typeof RULES | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? null;
}

/** Split `source` into tokens for `language`; unknown languages stay plain. */
export function highlight(source: string, language: string | null | undefined): HighlightResult {
  const resolved = resolveLanguage(language);
  const rules = resolved ? RULES[resolved] : undefined;
  if (!rules || rules.length === 0 || source.length === 0) {
    return { tokens: source ? [{ type: 'plain', value: source }] : [], language: resolved };
  }

  // Sticky copies let the scanner test rules at an exact offset without
  // re-compiling regexes or slicing the input on every step.
  const matchers = rules.map((rule) => {
    const flags = rule.pattern.flags.includes('y')
      ? rule.pattern.flags
      : `${rule.pattern.flags}y`;
    return { rule, pattern: new RegExp(rule.pattern.source, flags) };
  });

  const tokens: Token[] = [];
  let plainStart = 0;
  let offset = 0;

  while (offset < source.length) {
    let bestType: TokenType | null = null;
    let bestValue = '';

    for (const matcher of matchers) {
      matcher.pattern.lastIndex = offset;
      const match = matcher.pattern.exec(source);
      if (!match || match.index !== offset || match[0].length === 0) continue;
      if (match[0].length > bestValue.length) {
        bestType = matcher.rule.type;
        bestValue = match[0];
      }
    }

    if (bestType === null) {
      // No rule starts here: fold the character into the plain run.
      offset += 1;
      continue;
    }

    if (offset > plainStart) {
      tokens.push({ type: 'plain', value: source.slice(plainStart, offset) });
    }
    tokens.push({ type: bestType, value: bestValue });
    offset += bestValue.length;
    plainStart = offset;
  }

  if (plainStart < source.length) {
    tokens.push({ type: 'plain', value: source.slice(plainStart) });
  }

  return { tokens, language: resolved };
}

/** Every language the highlighter understands, for documentation/tests. */
export function supportedLanguages(): string[] {
  return Object.keys(RULES).sort();
}
