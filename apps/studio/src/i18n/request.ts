import { withSharedMessages } from '@artloupe/fascia/i18n/messages';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  // Shared chrome strings come from fascia; this app's catalog holds only what is its own
  // and wins on any key it redefines (e.g. `common.appName`).
  return {
    locale,
    messages: withSharedMessages(locale, (await import(`../../messages/${locale}.json`)).default),
  };
});
