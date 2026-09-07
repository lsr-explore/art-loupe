import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';

// No `vitest-canvas-mock` here, unlike the other apps: nothing on this surface draws to
// a canvas. Add it back alongside the dependency if that changes.

// The `declare module 'vitest'` augmentation lives in `vitest-axe.d.ts`; see that file.

expect.extend(matchers);
