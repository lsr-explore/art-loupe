'use client';

import { StandaloneMessage } from '@artloupe/fascia/components/blocks/standalone-message';
import './globals.css';

interface GlobalErrorProps {
  error: Error & { digest?: string };
}

/**
 * The last-resort boundary: an error thrown in the **root or locale layout itself**.
 *
 * `[locale]/error.tsx` cannot catch those — an error boundary does not catch a throw in
 * its own segment's layout — so without this file they fall through to the root
 * `app/layout.tsx`, which returns bare `children` and has no `<html>`/`<body>`. Next then
 * shows *"Missing <html> and <body> tags in the root layout"*, which is what a stopped
 * database or a malformed `NEXT_PUBLIC_*` origin looked like from the outside: not an
 * error page, an apparent crash. React replaces the whole document here, so this file
 * owns the document tags.
 *
 * **Copy is hard-coded English on purpose.** `global-error` renders above every provider
 * — no `NextIntlClientProvider`, so no `useTranslations`, and no locale to read anyway
 * once layout rendering is what failed. Calling a hook here would throw *inside* the
 * boundary meant to survive a throw. The entry origin is inlined at build time, which is
 * why it is read from `process.env` rather than the validated `env` module — that module
 * is one of the things that can fail.
 *
 * `error` is deliberately unread: a thrown message can carry a database detail, a stack
 * fragment or a signed-in identifier, and this renders straight to the user.
 */
const GlobalError = (_props: GlobalErrorProps) => (
  <html lang="en">
    <body>
      <StandaloneMessage
        labels={{
          orgName: 'Art Loupe',
          title: 'This page is temporarily unavailable',
          message:
            'Something went wrong loading this surface. It is a demonstration environment, so a service may still be starting up. You can start again from the Art Loupe entry point.',
          actionLabel: 'Go to Art Loupe',
        }}
        actionHref={'/'}
      />
    </body>
  </html>
);

export default GlobalError;
