import { StandaloneMessage } from '@artloupe/fascia/components/blocks/standalone-message';
import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

/**
 * The 404 for URLs that match no route at all.
 *
 * Without this file those URLs fall to the root `app/layout.tsx`, which returns bare
 * `children` because `<html>`/`<body>` live in `app/[locale]/layout.tsx` — the layout
 * an unmatched URL never reaches. Next then refuses to render and shows *"Missing
 * `<html>` and `<body>` tags in the root layout"*, so a plain wrong link reads to the
 * visitor as the application crashing. `global-not-found` is the documented answer for
 * a root layout defined under a top-level dynamic segment: it bypasses layout rendering
 * and returns a whole document itself, which is why the font and `globals.css` are
 * imported here rather than inherited.
 *
 * It requires `experimental.globalNotFound` in `next.config.ts` (Next 16.2).
 *
 * Copy is resolved at the **default locale**: routing never ran, so there is no
 * negotiated locale to read — `/es/nope` lands here in English. A stranded visitor
 * getting a usable page in the wrong language beats a crash in the right one.
 */
export const metadata: Metadata = {
  title: 'Page not found — Art Loupe',
};

const GlobalNotFound = async () => {
  const translate = await getTranslations({
    locale: routing.defaultLocale,
    namespace: 'standalone',
  });
  const tc = await getTranslations({ locale: routing.defaultLocale, namespace: 'common' });

  return (
    <html lang={routing.defaultLocale} className={`${geistSans.variable} h-full antialiased`}>
      <body>
        <StandaloneMessage
          labels={{
            orgName: tc('orgName'),
            title: translate('notFoundTitle'),
            message: translate('notFoundMessage'),
            actionLabel: translate('backToEntry'),
          }}
          // Same origin: this *is* the entry point.
          actionHref="/"
        />
      </body>
    </html>
  );
};

export default GlobalNotFound;
