import { LoginCard } from '@artloupe/fascia/components/blocks/login-card';
import { getLocale, getTranslations } from 'next-intl/server';
import { LoginBackdrop } from '@/components/auth/login-backdrop';
import { LoginSection } from '@/components/auth/login-section';

const LandingPage = async () => {
  const tl = await getTranslations('landing');
  const tc = await getTranslations('common');
  const locale = await getLocale();

  return (
    <LoginCard
      orgName={tc('orgName')}
      appName={tc('appName')}
      title={tc('logIn')}
      description={tl('description')}
      backdrop={<LoginBackdrop />}
    >
      <LoginSection locale={locale} />
    </LoginCard>
  );
};

export default LandingPage;
