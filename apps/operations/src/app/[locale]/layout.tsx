import { getSession } from '@artloupe/auth/server';
import { AppShell } from '@artloupe/fascia/components/blocks/app-shell';
import { shellLabels } from '@artloupe/fascia/components/blocks/shell-labels';
import { ThemeProvider } from '@artloupe/fascia/components/blocks/theme-provider';
import { UserChip } from '@artloupe/fascia/components/blocks/user-chip';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';
import { env } from '@/env';
import { logout } from './actions';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

/**
 * Localized per request rather than a static export: a hard-coded English `title`
 * leaves the browser tab, the search result and the social card in English on `/es`,
 * and a `<title>` is user-facing copy like any other string.
 *
 * `metadataBase` resolves the relative `opengraph-image.png` that Next generates from
 * `src/app/` into an absolute URL. Without it Next falls back to localhost and the
 * shared card 404s off this machine. Override per environment with NEXT_PUBLIC_APP_URL.
 */
export const generateMetadata = async ({ params }: LocaleParams): Promise<Metadata> => {
  const { locale } = await params;
  const tm = await getTranslations({ locale, namespace: 'metadata' });

  return {
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    title: tm('title'),
    description: tm('description'),
  };
};

interface LocaleLayoutProps extends LocaleParams {
  children: React.ReactNode;
}

/**
 * Deliberately no `sidebar` — operations has one route, and a rail holding a single
 * item is furniture pretending to be navigation. Omitting the
 * slot is what makes the dashboard render full-width.
 */
const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const translate = await getTranslations();
  const session = await getSession();
  const entryOrigin = env.NEXT_PUBLIC_ENTRY_URL ?? 'http://localhost:3003';

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages}>
            <AppShell
              labels={shellLabels(translate)}
              linkComponent={Link}
              aboutBaseHref={entryOrigin}
              // The org lockup leaves for the entry point — the only surface that
              // lists the others, so it is this demo's whole cross-app navigation.
              // The app name stays local and goes to this surface's home.
              orgHref={entryOrigin}
              homeHref="/home"
              languageControl={<LanguageToggle label={translate('language.label')} />}
              userControl={
                session ? (
                  <UserChip
                    username={session.username}
                    signedInAsLabel={translate('session.signedInAs')}
                    signOutLabel={translate('session.signOut')}
                    signOutAction={logout.bind(null, locale)}
                  />
                ) : null
              }
            >
              {children}
            </AppShell>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default LocaleLayout;
