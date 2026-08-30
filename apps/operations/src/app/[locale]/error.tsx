'use client';

import { Button } from '@artloupe/fascia/components/ui/button';
import { useTranslations } from 'next-intl';

interface GlobalErrorProps {
  error: Error;
  reset: () => void;
}

const GlobalError = ({ reset }: GlobalErrorProps) => {
  const te = useTranslations('errors');
  const tc = useTranslations('common');

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{te('somethingWentWrong')}</h1>
      {/*
        Deliberately not `error.message`. A thrown message can carry a database detail, a
        stack fragment or — on these surfaces — a signed-in identifier, and this component
        renders straight to the user. The generic string is the whole point of it.
      */}
      <p className="mt-2 text-muted-foreground">{te('unexpectedError')}</p>
      <Button onClick={reset} variant="outline" className="mt-6">
        {tc('tryAgain')}
      </Button>
    </div>
  );
};

export default GlobalError;
