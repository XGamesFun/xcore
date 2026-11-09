// ESLint: the recommended rules, for Node 24 ES modules. Formatting is Prettier's (.prettierrc.json). `npm run lint`
// runs both checks; CI runs it on every push.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // sample games the tests check, kept as a person would write them
  { ignores: ['node_modules/', 'tests/fixtures/', 'evidence/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // `catch {}` marks best-effort steps (a chmod Windows ignores, a file that may be missing)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `const { secret, ...rest } = entry` drops a field on purpose
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  // runs in a game's page, not in Node
  { files: ['loot-page/**'], languageOptions: { globals: { ...globals.browser } } },
  // the page client: a classic script, in a game's page
  { files: ['lib/client/gamesfun.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser } } },
  // the database: a Worker module on xgames.fun
  {
    files: ['lib/client/server/**'],
    languageOptions: {
      globals: { ...globals.serviceworker, WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' },
    },
  },
  // the page's documents for a game's own server: xcore add puts database.js's documents code where it says
  // __DOCS_CORE__, so these come from there
  {
    files: ['lib/client/server/gf-docs.js'],
    languageOptions: { globals: { createData: 'readonly', routeDatabase: 'readonly', serverData: 'readonly' } },
  },
  // the client's tests hand functions to Chrome, which run in the page (GamesFun, its window, Unity's stand-ins)
  {
    files: ['tests/client.test.mjs'],
    languageOptions: {
      globals: {
        ...globals.browser,
        GamesFun: 'readonly',
        codes: 'readonly',
        changes: 'readonly',
        LibraryManager: 'readonly',
        log: 'readonly',
        room: 'readonly',
        sent: 'readonly',
      },
    },
  },
];
