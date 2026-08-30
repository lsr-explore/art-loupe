import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
}));

/**
 * `redirect` unwinds by throwing, and the action relies on that. Mocking it as a plain
 * recorder would let execution continue past the call and hide an ordering mistake.
 */
class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`redirect:${location}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
}));

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_STUDIO_URL: undefined,
    NEXT_PUBLIC_OPERATIONS_URL: undefined,
  },
}));

import { acknowledgeAndLaunch } from './actions';

const STUDIO = 'http://localhost:3001';
const OPERATIONS = 'http://localhost:3000';

const submit = (fields: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }
  return formData;
};

/** Runs the action and reports where it sent the visitor, or `null` if it declined to. */
const launch = async (fields: Record<string, string>): Promise<string | null> => {
  try {
    await acknowledgeAndLaunch(submit(fields));
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return error.location;
    }
    throw error;
  }
  return null;
};

// @trace flow=platform.shell category=functionality
describe('acknowledgeAndLaunch', () => {
  beforeEach(() => {
    cookieSet.mockReset();
  });

  it('launches the studio when the studio panel is clicked', async () => {
    expect(await launch({ acknowledged: 'on', target: 'studio' })).toBe(STUDIO);
  });

  it('launches operations when the operations panel is clicked', async () => {
    expect(await launch({ acknowledged: 'on', target: 'operations' })).toBe(OPERATIONS);
  });

  it('records the acknowledgement before launching', async () => {
    await launch({ acknowledged: 'on', target: 'studio' });

    expect(cookieSet).toHaveBeenCalledTimes(1);
  });

  it('resumes a deep link that points at the clicked surface', async () => {
    const resumeTo = `${OPERATIONS}/en/home`;

    expect(await launch({ acknowledged: 'on', target: 'operations', next: resumeTo })).toBe(
      resumeTo,
    );
  });

  /**
   * The regression this file was written for. An unacknowledged visitor bounced off
   * operations lands on the entry point carrying `next=<operations>`; clicking Artist
   * Studio then took them to Operations Control, because `next` was honoured
   * unconditionally. The click is the fresher signal and has to win.
   */
  it('prefers the clicked panel over a deep link to a different surface', async () => {
    expect(
      await launch({ acknowledged: 'on', target: 'studio', next: `${OPERATIONS}/en/home` }),
    ).toBe(STUDIO);
  });

  it('ignores a deep link to a surface we do not own', async () => {
    expect(
      await launch({
        acknowledged: 'on',
        target: 'studio',
        next: 'https://studio.artloupestudio.com.attacker.test/',
      }),
    ).toBe(STUDIO);
  });

  it('does not launch or set the cookie when the box is unticked', async () => {
    expect(await launch({ target: 'studio' })).toBeNull();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('does not launch for a target that is not a known surface', async () => {
    expect(await launch({ acknowledged: 'on', target: 'gallery' })).toBeNull();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
