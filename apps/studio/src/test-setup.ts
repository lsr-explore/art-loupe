import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import type { AxeMatchers } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import 'vitest-canvas-mock';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

expect.extend(matchers);
