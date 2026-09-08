import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const HomePage = async () => {
  const th = await getTranslations('home');

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{th('title')}</h1>
        <p className="text-sm text-muted-foreground">{th('description')}</p>
      </div>
      {/*
        A link, not a button styled as one. It navigates and nothing else, so it has to be
        something a keyboard opens in a new tab and a screen reader announces as a link.
        There is no project list to show yet, so this is the whole of the home page's job.
      */}
      <div>
        <Link
          className="inline-flex h-9 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href="/projects/new"
        >
          {th('startProject')}
        </Link>
      </div>
    </div>
  );
};

export default HomePage;
