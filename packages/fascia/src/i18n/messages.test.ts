import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARED_LOCALES, withSharedMessages } from './messages';

afterEach(() => {
  vi.restoreAllMocks();
});

// @trace flow=platform.shell category=functionality
describe('withSharedMessages', () => {
  it('ships a catalog for every locale the apps route', () => {
    // If a locale is added to `routing.ts` without a matching fascia catalog, the chrome
    // silently stays English. Keep this list in step with `apps/*/src/i18n/routing.ts`.
    expect(SHARED_LOCALES).toEqual(['en', 'es']);
  });

  it('supplies shared chrome the app never defines', () => {
    const merged = withSharedMessages('en', {}) as Record<string, Record<string, string>>;

    expect(merged.theme.dark).toBe('Dark');
    expect(merged.errors.somethingWentWrong).toBeTruthy();
  });

  it('returns the requested locale, not the default', () => {
    const merged = withSharedMessages('es', {}) as Record<string, Record<string, string>>;

    expect(merged.theme.dark).toBe('Oscuro');
  });

  // The bug this guards: a shallow `{...shared, ...app}` would let an app that defines
  // `common.appName` replace the whole `common` namespace and drop every shared key in it.
  it('merges into a namespace rather than replacing it', () => {
    const merged = withSharedMessages('en', {
      common: { appName: 'Artist Studio' },
    }) as Record<string, Record<string, string>>;

    expect(merged.common.appName).toBe('Artist Studio');
    expect(merged.common.goHome).toBe('Go home');
  });

  it('lets the app win on a key both define', () => {
    const merged = withSharedMessages('en', {
      common: { goHome: 'Back to start' },
    }) as Record<string, Record<string, string>>;

    expect(merged.common.goHome).toBe('Back to start');
  });

  it('falls back to English for an unknown locale rather than throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const merged = withSharedMessages('pt', {}) as Record<string, Record<string, string>>;

    expect(merged.theme.dark).toBe('Dark');
  });

  // Falling back is correct; falling back *quietly* is the trap — app strings would render
  // in the new locale while the chrome stayed English, with nothing failing.
  it('warns when it falls back, naming the locale and the fix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withSharedMessages('pt', {});

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('"pt"');
    expect(warn.mock.calls[0][0]).toContain('messages/pt.json');
  });

  it('stays quiet for a locale it does ship', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withSharedMessages('es', {});

    expect(warn).not.toHaveBeenCalled();
  });
});
