// Stylelint for CSS. A JS module rather than JSON so each exception can say why it exists.
// Most of them teach Stylelint about Tailwind v4, whose at-rules and functions are not
// standard CSS.

const TAILWIND_AT_RULES = [
  'apply',
  'theme',
  'custom-variant',
  'utility',
  'variant',
  'source',
  'config',
  'tailwind',
];

/** @type {import('stylelint').Config} */
const config = {
  extends: ['stylelint-config-standard'],
  rules: {
    // Tailwind's at-rules are unknown to plain CSS. `layer` and `import` are listed because
    // Tailwind gives them extra meanings that the standard grammar does not cover.
    'at-rule-no-unknown': [true, { ignoreAtRules: [...TAILWIND_AT_RULES, 'layer', 'import'] }],
    // Added in Stylelint 17.16: validates at-rule preludes against CSS grammar. Tailwind
    // preludes are class lists (`@apply bg-background`), so they are exempt. Standard
    // at-rules such as `@media`, `@layer` and `@import` are still validated.
    'at-rule-prelude-no-invalid': [true, { ignoreAtRules: TAILWIND_AT_RULES }],
    // `theme()` is Tailwind's function. `oklch()` is standard CSS, but this rule's function
    // list does not include it yet, and every design token is written in it.
    'function-no-unknown': [true, { ignoreFunctions: ['theme', 'oklch'] }],
    // Tailwind v4 is imported as `@import "tailwindcss"`. The standard config's preferred
    // `url()` notation does not resolve a package that way.
    'import-notation': null,
  },
  ignoreFiles: [
    '**/.next/**',
    '**/out/**',
    '**/dist/**',
    '**/storybook-static/**',
    '**/coverage/**',
    '**/htmlcov/**',
    '**/node_modules/**',
    '**/src/stories/**',
    '**/playwright-report/**',
  ],
};

export default config;
