'use client';

import { LanguageSelect } from '@artloupe/fascia/components/blocks/language-select';
import { localeOptions } from '@artloupe/fascia/i18n/locales';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { type Locale, routing } from '@/i18n/routing';

/**
 * Options are derived from this app's own `routing.locales`, so the picker cannot
 * offer a locale the app does not route. The autonyms behind them are shared.
 */
const options = localeOptions(routing.locales);

/**
 * Routing half of the header's locale picker. `<LanguageSelect>` in `fascia` owns
 * the markup; this stays app-local because `useRouter` / `usePathname` come from
 * `@/i18n/navigation`, which is generated from this app's own routing config.
 */
export const LanguageToggle = ({ label }: { label: string }) => {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <LanguageSelect
      locale={locale}
      label={label}
      locales={options}
      onSelect={(next) => router.replace(pathname, { locale: next as Locale })}
    />
  );
};
