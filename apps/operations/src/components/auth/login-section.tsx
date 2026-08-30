'use client';

import { LoginForm } from '@artloupe/fascia/components/blocks/login-form';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { type LoginState, login } from '@/app/[locale]/actions';

const INITIAL_STATE: LoginState = { error: false };

interface LoginSectionProps {
  locale: string;
}

/**
 * The operator auth form. The server action (bound with the locale) handles
 * credentials, the role check, and the redirect.
 *
 * The synthetic-data acknowledgement used to gate this form's submit. It moved to
 * the entry point: it is now a domain-scoped cookie set once
 * at the apex, and this app's middleware redirects an unacknowledged visitor there
 * before this screen ever renders. Re-adding a checkbox here would ask a second
 * time for something already given, and the middleware would still be the thing
 * actually enforcing it.
 */
export const LoginSection = ({ locale }: LoginSectionProps) => {
  const tl = useTranslations('landing');
  const [state, formAction] = useActionState(login.bind(null, locale), INITIAL_STATE);

  return (
    <LoginForm
      action={formAction}
      // "Operator ID" and "Access Key" are the console's own wording for an ordinary
      // Supabase email/password pair. The reveal toggle takes the same
      // wording, so its accessible name doesn't announce a "password" the screen never
      // mentions.
      //
      // the spec's original claim — that these were cosmetic labels over demo auth with no
      // separate role or seed data — no longer holds: operators are real Supabase
      // accounts carrying `app_metadata.artloupe_role`, seeded by
      // scripts/seed/seed-demo-accounts.sh, and the login refuses every other role.
      usernameLabel={tl('identifierLabel')}
      usernameType="email"
      usernameAutoComplete="email"
      passwordLabel={tl('accessKeyLabel')}
      showPasswordLabel={tl('showAccessKey')}
      hidePasswordLabel={tl('hideAccessKey')}
      submitLabel={tl('signIn')}
      error={state.error ? tl('errorInvalid') : undefined}
      className="max-w-none"
    />
  );
};
