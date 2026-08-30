import type { LocaleOption } from '../components/blocks/language-select';

/**
 * Each language's own name for itself.
 *
 * Autonyms rather than abbreviations or flags: a flag
 * denotes a country, not a language, and "ES" read aloud is ambiguous between
 * Spanish, Estonian and Spain.
 *
 * Keys track `packages/fascia/messages/*.json` — a locale with chrome strings should
 * have a name to display, and vice versa.
 */
export const LOCALE_AUTONYMS: Record<string, string> = {
  en: 'English',
  es: 'Español',
};

/**
 * Build the header picker's options from an app's **own** `routing.locales`.
 *
 * Derived rather than hand-listed so the picker cannot drift from what the app
 * actually routes: a locale added to `routing` appears here automatically, and one
 * removed disappears. A duplicated literal array in each app — which is what this
 * replaces — would have had to be edited in lockstep with four routing configs.
 *
 * An unrecognised locale falls back to its own code rather than throwing, matching
 * how `withSharedMessages` degrades to English chrome instead of 500-ing the page.
 * "pt" in the dropdown is a visible prompt to add the autonym; a crash is not.
 */
export const localeOptions = (locales: readonly string[]): LocaleOption[] =>
  locales.map((value) => ({ value, label: LOCALE_AUTONYMS[value] ?? value }));
