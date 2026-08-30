import { defineConfig, globalIgnores } from 'eslint/config';
import biome from 'eslint-config-biome';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Shared base config. Each app/package extends via `extends` in its own eslint.config.mjs.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      'id-length': [
        'error',
        {
          min: 2,
          exceptions: ['_'],
          exceptionPatterns: ['^_'],
          properties: 'never',
        },
      ],
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
    },
  },

  {
    // App Router only (no `pages/` dir). This Pages-Router rule can't resolve a pages
    // directory at the monorepo root and otherwise prints a noisy "Pages directory
    // cannot be found" message on every `eslint .` run. Universal (no `files`) so it also
    // covers `.mjs`/`.cjs` config files, where the rule would otherwise still fire.
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  {
    settings: {
      react: {
        version: '19.2.4',
      },
    },
  },

  globalIgnores([
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    '**/next-env.d.ts',
    '**/storybook-static/**',
    '**/coverage/**',
    // coverage.py's HTML report, written by `poe test-cov-contexts` and gitignored via
    // python/.gitignore. Its bundled viewer JS is not ours and trips func-style/id-length,
    // so linting it would make `pnpm lint` fail for anyone who ran the coverage task.
    // (`**/coverage/**` above is the JS-side reportsDirectory; coverage.py uses htmlcov/.)
    '**/htmlcov/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/.agents/skills/**',
    // Supabase CLI runtime state, created by `pnpm supabase start` and gitignored
    // via supabase/.gitignore. It contains a minified edge-runtime bootstrap, so
    // linting it fails with ~100 id-length/no-var errors on code we do not own.
    // CI never sees it (clean checkout); this keeps `pnpm check:all` honest locally.
    'supabase/.temp/**',
  ]),

  biome,

  // Accessibility is owned by eslint-plugin-jsx-a11y; Biome's overlapping a11y group
  // is intentionally disabled (biome.json). This block MUST come after `biome` —
  // eslint-config-biome turns off every rule Biome can own (a11y included), so the
  // jsx-a11y rules have to be re-applied last to actually run.
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
]);

export default eslintConfig;
