import { getTranslations } from 'next-intl/server';

const HomePage = async () => {
  const th = await getTranslations('home');

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{th('title')}</h1>
        <p className="text-sm text-muted-foreground">{th('description')}</p>
      </div>
    </div>
  );
};

export default HomePage;
