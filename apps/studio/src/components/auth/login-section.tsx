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
 * The demo auth form. The server action (bound with the locale) handles
 * credentials and redirect.
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
      // "Artist ID" is a friendlier label over the same auth —
      // the value typed is still an email, so the field keeps `type="email"` for the
      // format check and the right mobile keyboard. There is no separate credential
      // type, role, or seed data behind it.
      usernameLabel={tl('identifierLabel')}
      usernameType="email"
      usernameAutoComplete="email"
      passwordLabel={tl('passwordLabel')}
      showPasswordLabel={tl('showPassword')}
      hidePasswordLabel={tl('hidePassword')}
      submitLabel={tl('signIn')}
      error={state.error ? tl('errorInvalid') : undefined}
      className="max-w-none"
    />
  );
};
