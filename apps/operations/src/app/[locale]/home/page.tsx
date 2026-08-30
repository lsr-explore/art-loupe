import { getTranslations } from 'next-intl/server';

const HomePage = async () => {
  const th = await getTranslations('home');

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-4 border-b px-4 py-16 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {th('title')}
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{th('description')}</p>
      </section>
    </div>
  );
};

export default HomePage;
