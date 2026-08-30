import { LoginCard } from '@artloupe/fascia/components/blocks/login-card';
import { getLocale, getTranslations } from 'next-intl/server';
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
      // A gradient rather than a photograph. Weighted top-down and
      // deeper than the studio's, which is the closest the tokens get to the
      // night-lighthouse mood of the console mockup without a supplied asset.
      backdrop={
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-b from-primary/25 via-background to-background"
        />
      }
    >
      <LoginSection locale={locale} />
    </LoginCard>
  );
};

export default LandingPage;
