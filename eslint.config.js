import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import { builtinModules } from 'node:module';

// Node builtins are imported as `node:fs`, never `fs`: the prefix cannot be
// shadowed by a package and marks a platform import.
const nodePrefixOnly = {
  paths: builtinModules.map((name) => ({
    name,
    message: `Import it as 'node:${name}'.`,
  })),
};

// Globals the sandbox hands to game scripts and modules. A new script
// global also goes in engine/scripting/api.ts, scripts/global.d.ts and,
// if browser-side, the client `engine` object.
const scriptGlobals = [
  'on',
  'attach',
  'config',
  'getPlayer',
  'getPlayers',
  'getNearbyNpcs',
  'getSpells',
  'createSpells',
  'getDialog',
  'getQuest',
  'getQuests',
  'getRecipes',
  'getArrow',
  'getArrows',
  'getItem',
  'getItems',
  'getMapSize',
  'getMapTile',
  'setMapTile',
  'getMapPvp',
  'spawnNpc',
  'despawnNpc',
  'moveNpcToward',
  'TILE_SIZE',
  'giveItem',
  'removeItem',
  'hasItem',
  'countItem',
  'canCarry',
  'moveItem',
  'exchangeItems',
  'coroutine',
  'wait',
  'waitFor',
  'persistNow',
  'commitInventories',
  'delivery',
  'auctions',
  'Items',
  'Npcs',
  'Maps',
  'Spells',
  'Arrows',
  'healPlayer',
  'killPlayer',
  'dealDamage',
  'giveExperience',
  'setNameColor',
  'setNameTag',
  'setCosmetic',
  'clearCosmetic',
  'getPlayerData',
  'setPlayerData',
  'store',
  'flags',
  'teleportPlayer',
  'sendMessage',
  'broadcastMessage',
  'setChatIgnored',
  'i18n',
  't',
  'sendEvent',
  'sendMapEvent',
  'broadcastEvent',
  'httpRequest',
  'provide',
  'use',
  'Access',
  'command',
  'after',
  'every',
  'cancel',
  'msToTicks',
  'TICK_RATE',
  'random',
  'randomInt',
  'randomChance',
  'randomPick',
  'setTimeout',
  'setInterval',
  'clearInterval',
  'log',
  'warn',
  'error',
];

const readonly = (names) =>
  Object.fromEntries(names.map((name) => [name, 'readonly']));

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      '**/*.cjs',
      '**/bundle.js',
      // Declarations have nothing to lint, and the ones under modules/ and
      // scripts/ belong to no tsconfig the type-aware rules could read.
      '**/*.d.ts',
      'src/server/model/seed.ts',
    ],
  },

  // TypeScript, everywhere it is compiled: src, bench, tools, e2e.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.server.json',
          './tsconfig.client.json',
          './bench/tsconfig.json',
          './tools/tsconfig.json',
          './e2e/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-restricted-imports': ['error', nodePrefixOnly],
      // `any` written out marks a wire, sandbox or JSON seam; the unsafe uses
      // of it still warn, which is where mistakes show.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Only fails on promises handed to Express outside createRouter, which
      // crash the process; async onClick handlers catch their own errors.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // `any` crosses the wire, sandbox and JSON seams and is cast once to the
      // declared type, so these warn rather than error.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      // An async function that never awaits still works when awaited, so it
      // warns; await-thenable stays an error.
      '@typescript-eslint/require-await': 'warn',
      // The REST client rejects with `HttpError`, a plain `{ status, message }`
      // read through `httpError()`. Making it an Error subclass would help the
      // stack trace but changes the client's error handling, so the shape is
      // named here instead of switching the rule off.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'file', name: 'HttpError' }] },
      ],
    },
  },

  // React, only where there is React. The old config ran the react plugin over
  // the server too and then switched rules-of-hooks back off per directory.
  {
    files: ['src/client/**/*.{ts,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
    ],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/prop-types': 'off',
      // The two rules this repo runs. eslint-plugin-react-hooks 7 also ships
      // the React Compiler set (immutability, purity, use-memo and more) in its
      // recommended config, and adopting it changes how the client is written.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Every sentence a player or operator reads goes through src/client/i18n,
      // or it renders untranslated without anyone noticing.
      //
      // Props are not checked, so placeholder, title and aria-label are keyed
      // by hand. Glyphs and <code> contents read the same in every language.
      'react/jsx-no-literals': [
        'error',
        {
          noStrings: true,
          ignoreProps: true,
          allowedStrings: [
            '✕',
            '×',
            '▲',
            '▼',
            '◀',
            '▶',
            '⚔',
            '☰',
            '↧',
            '»',
            '−',
            '+',
            '→',
            '↩',
            '↪',
            '›',
            '·',
            '%',
            '/',
            ',',
            '.',
            ':',
            '-',
            '*',
            'x',
            '(',
            ')',
          ],
          elementOverrides: { code: { allowElement: true } },
        },
      ],
    },
  },

  {
    // A test renders text to assert on it; there is nobody to read it in
    // another language.
    files: ['src/client/**/*.test.{ts,tsx}'],
    rules: { 'react/jsx-no-literals': 'off' },
  },

  {
    // createRouter() routers forward a rejected handler promise to the error
    // middleware (app.ts), which Express's void-returning types cannot express.
    files: ['src/server/http/routes/**/*.ts', 'src/server/app.test.ts'],
    rules: {
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false, arguments: false } },
      ],
    },
  },

  {
    // Tests read HTTP bodies, KV documents and sandbox results as the untyped
    // values they are.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  {
    // Sandboxed code is loaded, not compiled, so it has no tsconfig for the
    // type-aware rules to read.
    files: ['modules/**/server.js', 'demos/*/scripts/**/*.js'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'script',
      globals: { ...readonly(scriptGlobals) },
    },
  },

  {
    files: ['modules/**/client.{js,jsx}'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, engine: 'readonly', React: 'readonly' },
    },
  },

  {
    // JSX compiles to React.createElement (moduleLoader.ts), so the classic
    // runtime's rules, not the jsx-runtime ones the client bundle uses.
    files: ['modules/**/client.jsx'],
    extends: [react.configs.flat.recommended],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Last, so it wins: it switches off the stylistic rules prettier already
  // decides and turns a formatting difference into a lint error.
  prettier,
);
