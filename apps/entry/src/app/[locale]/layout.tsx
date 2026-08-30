import { AppShell } from '@artloupe/fascia/components/blocks/app-shell';
import { shellLabels } from '@artloupe/fascia/components/blocks/shell-labels';
import { ThemeProvider } from '@artloupe/fascia/components/blocks/theme-provider';
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
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3003'),
    title: tm('title'),
    description: tm('description'),
  };
};

interface LocaleLayoutProps extends LocaleParams {
  children: React.ReactNode;
}

/**
 * The entry point's shell differs from the other three in exactly two ways, both
 * settled deliberately:
 *
 * - **No user chip, and no "Log in".** This surface is never authenticated — it reads
 *   no session, and its `proxy.ts` does locale negotiation only. The panels launch the
 *   apps; each app decides whether to show its login or its home.
 *   It *does* depend on `@artloupe/auth`, but only for the `@artloupe/auth/ack` subpath —
 *   the acknowledgement cookie's name, shared with the three middlewares that read
 *   what this surface writes. That subpath carries no session machinery; "never
 *   authenticated" is a claim about the session, not about the package graph.
 * - **No app name after the separator.** This *is* the organisation's front door, so
 *   there is nothing to qualify "Art Loupe" with. An About link takes the
 *   chip's place, first in the control row.
 *
 * `aboutBaseHref` is omitted because About is same-origin here; the other three
 * surfaces link across to it.
 */
const LocaleLayout = async ({ children, params }: LocaleLayoutProps) => {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const translate = await getTranslations();

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
              labels={shellLabels(translate, { appName: undefined })}
              linkComponent={Link}
              languageControl={<LanguageToggle label={translate('language.label')} />}
              leadingControl={
                // A plain anchor rather than the locale-aware Link: the About site is
                // English-only, so a /es/about URL would 404.
                <a
                  href="/about"
                  className="rounded-sm px-2 py-1 font-medium text-muted-foreground text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {translate('entry.about')}
                </a>
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
