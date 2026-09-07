import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as matchers from 'vitest-axe/matchers';
import 'vitest-canvas-mock';

// The `declare module 'vitest'` augmentation lives in `vitest-axe.d.ts`; see that file.

expect.extend(matchers);
