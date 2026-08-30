import type { AppShellLabels } from './app-shell';

/**
 * A root-namespace translator — next-intl's `await getTranslations()` with no
 * namespace argument, so keys are addressed by full path.
 */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Build `<AppShell>`'s label bundle from an app's root translator.
 *
 * The shell takes ~15 strings. Assembling that object by hand in four `layout.tsx`
 * files is four chances to mistype a key and four places to edit when one is added —
 * which is the same duplication `<AppShell>` itself exists to remove, displaced one
 * level up.
 *
 * The key paths below are the shared catalog's contract
 * (`packages/fascia/messages/*.json`, merged per app by `withSharedMessages`).
 * `common.orgName` and `common.appName` are the two exceptions: app-local by
 * definition, and supplied by each app's own catalog.
 */
export const shellLabels = (
  translate: Translate,
  overrides: Partial<AppShellLabels> = {},
): AppShellLabels => ({
  orgName: translate('common.orgName'),
  appName: translate('common.appName'),
  banner: translate('shell.banner'),
  skipToContent: translate('shell.skipToContent'),
  sidebarLabel: translate('shell.sidebarLabel'),
  openSidebar: translate('shell.openSidebar'),
  closeSidebar: translate('shell.closeSidebar'),
  theme: {
    label: translate('theme.label'),
    system: translate('theme.system'),
    light: translate('theme.light'),
    dark: translate('theme.dark'),
  },
  footer: {
    label: translate('footer.label'),
    accessibility: translate('footer.accessibility'),
    privacy: translate('footer.privacy'),
    reportIssue: translate('footer.reportIssue'),
    opensInNewTab: translate('footer.opensInNewTab'),
    // Dynamic, not the literal "2026" the notes asked for.
    copyright: translate('footer.copyright', { year: new Date().getFullYear() }),
  },
  ...overrides,
});
