// Flat ESLint config (ESLint 9). Deliberately lean: catch genuinely broken
// code (undeclared names, unreachable code, duplicate keys) without imposing a
// style regime — Prettier/formatting is left to contributors' editors. No
// plugins, so `npm ci` stays light; espree parses JSX via ecmaFeatures.
const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', module: 'writable',
  require: 'readonly', exports: 'writable', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', setImmediate: 'readonly', URL: 'readonly',
  URLSearchParams: 'readonly', fetch: 'readonly', AbortSignal: 'readonly',
  AbortController: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
  Blob: 'readonly', FormData: 'readonly', structuredClone: 'readonly',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly',
  fetch: 'readonly', alert: 'readonly', confirm: 'readonly', navigator: 'readonly',
  HTMLInputElement: 'readonly', HTMLSelectElement: 'readonly', Event: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', TextDecoder: 'readonly',
  FormData: 'readonly', Blob: 'readonly', setTimeout: 'readonly', console: 'readonly',
};

export default [
  { ignores: ['client/dist/**', 'node_modules/**', '.venv/**', 'server/data/**'] },
  {
    files: ['**/*.{js,mjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_|^React$' }],
    },
  },
  // Server + scripts + tests → Node globals.
  {
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.mjs', '*.js', '*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
  // Client → browser globals. no-unused-vars is off for JSX: without the React
  // plugin, ESLint can't see that a component is used in <Jsx/>, so it would
  // flag every imported/defined component as unused (all false positives).
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: { globals: browserGlobals },
    rules: { 'no-unused-vars': 'off' },
  },
];
