import en from '../../messages/en.json';
import es from '../../messages/es.json';

/**
 * Chrome strings every surface renders identically — the theme and language controls, the
 * user chip, error and not-found copy, and the handful of `common` verbs.
 *
 * They live here rather than in four app catalogs because `<AppShell>` renders the
 * same chrome on all four surfaces, and eight copies of "Sign out" in two locales drift the
 * first time one of them is reworded.
 *
 * What is deliberately **not** here:
 *
 * - `common.appName` and `common.orgName` — app-specific by definition. The merge lets an
 *   app override any shared key, which is how those stay local.
 * - `nav` — it looks duplicated but isn't: each app's section list has the same
 *   *shape* and unrelated *content*. Lifting it would force one app's labels onto
 *   another.
 */
const SHARED = { en, es } as const;

type Messages = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Messages =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Recursive merge where the app wins. Shallow `{...shared, ...app}` would be wrong: an app
 * that defines `common.appName` would replace the whole `common` namespace and silently
 * drop every shared key in it.
 */
const deepMerge = (base: Messages, override: Messages): Messages => {
  const merged: Messages = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }

  return merged;
};

/** Locales this catalog ships. An app routing a locale absent here gets English chrome. */
export const SHARED_LOCALES = Object.keys(SHARED);

/**
 * Merge the shared chrome catalog under an app's own messages for `locale`.
 *
 * Falls back to English shared strings for an unknown locale rather than throwing — a
 * missing translation should degrade to readable text, not a 500 on every page.
 *
 * It warns while doing so, because the failure it guards is invisible otherwise. `SHARED`
 * is a static map, while each app loads its own catalog by dynamic import — so adding
 * `pt.json` to the apps and routing `pt` is enough to make app strings Portuguese, and this
 * file has to be edited separately or the chrome stays English. That renders a half-
 * translated page with nothing failing: no error, no missing key, no failing test. The
 * warning is what turns "silently mixed locale" into something QA can see.
 */
export const withSharedMessages = (locale: string, appMessages: Messages): Messages => {
  const shared = SHARED[locale as keyof typeof SHARED];

  if (!shared) {
    console.warn(
      `[fascia/i18n] No shared chrome catalog for locale "${locale}" — falling back to English. ` +
        `Add packages/fascia/messages/${locale}.json and register it in src/i18n/messages.ts, ` +
        `or the theme, language, session and error strings will stay English while the rest of ` +
        `the page is translated.`,
    );
  }

  return deepMerge((shared ?? SHARED.en) as Messages, appMessages);
};
