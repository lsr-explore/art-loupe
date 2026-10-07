/**
 * The `vitest-axe` matcher augmentation, kept in a `.d.ts` deliberately.
 *
 * `@testing-library/jest-dom` and vitest declare `Assertion` with different type-parameter
 * arities, and `skipLibCheck` hides that only inside declaration files. Writing this block in
 * a `.ts` makes the pre-existing conflict surface as TS2428.
 *
 * Full explanation, and the condition for reverting it:
 * `packages/fascia/src/vitest-axe.d.ts`.
 */

import type { AxeMatchers } from 'vitest-axe';

declare module 'vitest' {
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // oxlint-disable-next-line typescript/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
