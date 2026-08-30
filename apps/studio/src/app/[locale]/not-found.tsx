import { Button } from '@artloupe/fascia/components/ui/button';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

const NotFound = async () => {
  const tn = await getTranslations('notFound');
  const tc = await getTranslations('common');

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-4xl font-bold">{tn('title')}</h1>
      <p className="mt-2 text-lg text-muted-foreground">{tn('message')}</p>
      <Button variant="outline" className="mt-6" render={<Link href="/" />}>
        {tc('goHome')}
      </Button>
    </div>
  );
};

export default NotFound;
