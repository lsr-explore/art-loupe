/**
 * The `vitest-axe` matcher augmentation.
 *
 * This lives in a `.d.ts` rather than beside `expect.extend()` in `test-setup.ts`, and the
 * distinction is load bearing rather than cosmetic.
 *
 * `@testing-library/jest-dom@7.0.1` — the latest release — augments `vitest`'s `Assertion`
 * with **one** type parameter (`Assertion<T = any>`). Vitest 5 declares it with **two**
 * (`Assertion<R extends void | Promise<void> = void, T = unknown>`). Those two declarations
 * are already incompatible with each other, and TS2428 requires every merged declaration to
 * repeat the parameter list exactly — so there is no arity this file could choose that
 * satisfies both.
 *
 * The conflict is invisible today only because `skipLibCheck: true` (tsconfig.base.json)
 * skips type checking inside declaration files, which is where jest-dom's version lives.
 * An augmentation written in a `.ts` file is *not* skipped, so it became the one place the
 * pre-existing incompatibility surfaced.
 *
 * Putting ours in a `.d.ts` gives it the same treatment jest-dom's already gets. Nothing is
 * being worked around that was not already being tolerated, and the matchers themselves are
 * registered at runtime by `expect.extend()`, which types never touch.
 *
 * Remove this file and inline the block again once jest-dom ships types matching vitest's
 * `Assertion` arity.
 */

import type { AxeMatchers } from 'vitest-axe';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
