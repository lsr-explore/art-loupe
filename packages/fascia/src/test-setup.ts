import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';
// axe probes canvas for contrast checks; jsdom has no 2d context without it.
import 'vitest-canvas-mock';

// The `declare module 'vitest'` augmentation lives in `vitest-axe.d.ts`, not here. See that
// file for why the distinction matters.
expect.extend(matchers);
