'use client';

import { Button } from '@artloupe/fascia/components/ui/button';
import {
  learningResponseSchema,
  type LearningAnswer,
  type LearningRequest,
} from '@artloupe/schemas/learning';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

interface Exchange {
  id: string;
  question: string;
  answer: LearningAnswer;
}

export const LearningChat = () => {
  const translate = useTranslations('learning');
  const intake = useTranslations('intake');
  const locale = useLocale();
  const prefix = useId();
  const [question, setQuestion] = useState('');
  const [medium, setMedium] = useState<LearningRequest['medium']>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => () => controller.current?.abort(), []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked.current || question.trim().length < 3) return;
    locked.current = true;
    setPending(true);
    setError(null);
    const asked = question.trim();
    const abort = new AbortController();
    controller.current = abort;
    const history = exchanges.slice(-3).flatMap((exchange) => [
      { role: 'user' as const, content: exchange.question },
      {
        role: 'assistant' as const,
        content: (
          exchange.answer.claims.map((claim) => claim.text).join(' ') ||
          exchange.answer.gap ||
          ''
        ).slice(0, 2000),
      },
    ]);
    try {
      const response = await fetch('/api/learning', {
        method: 'POST',
        signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: asked, locale, medium, history }),
      });
      if (!response.ok) {
        setError(
          translate(
            response.status === 401
              ? 'sessionEnded'
              : response.status === 413
                ? 'tokenLimit'
                : response.status === 429
                  ? 'rateLimited'
                  : 'unavailable',
          ),
        );
        return;
      }
      const answer = learningResponseSchema.parse(await response.json());
      setExchanges((previous) => [
        ...previous.slice(-19),
        { id: crypto.randomUUID(), question: asked, answer },
      ]);
      setQuestion('');
    } catch {
      if (!abort.signal.aborted) setError(translate('unavailable'));
    } finally {
      locked.current = false;
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{translate('title')}</h1>
        <p className="text-muted-foreground">{translate('description')}</p>
        <p className="text-sm text-muted-foreground">{translate('privacy')}</p>
      </header>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{translate('examples')}</legend>
        {(['exampleValue', 'exampleSpace', 'exampleImpressionism'] as const).map((key) => (
          <Button
            key={key}
            variant="outline"
            className="min-h-11 whitespace-normal"
            disabled={pending}
            onClick={() => setQuestion(translate(key))}
          >
            {translate(key)}
          </Button>
        ))}
      </fieldset>
      <section aria-label={translate('conversation')} className="space-y-6">
        {exchanges.map((exchange) => (
          <article key={exchange.id} className="space-y-4 rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold">{exchange.question}</h2>
            {exchange.answer.status === 'insufficient_evidence' && <p>{exchange.answer.gap}</p>}
            {exchange.answer.claims.map((claim, index) => (
              <p key={`${exchange.id}-claim-${index}`}>
                {claim.text}{' '}
                {claim.citation_ids.map((identity) => {
                  const position = exchange.answer.sources.findIndex(
                    (source) => source.id === identity,
                  );
                  return (
                    <a
                      key={identity}
                      href={`#${prefix}-${exchange.id}-${identity}`}
                      onClick={() => {
                        const target = document.getElementById(
                          `${prefix}-${exchange.id}-${identity}`,
                        );
                        if (target instanceof HTMLDetailsElement) target.open = true;
                      }}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center underline"
                      aria-label={translate('citation', { number: position + 1 })}
                    >
                      [{position + 1}]
                    </a>
                  );
                })}
              </p>
            ))}
            {exchange.answer.practice && (
              <div className="rounded-lg bg-muted p-4">
                <h3 className="font-semibold">{translate('practice')}</h3>
                <p>{exchange.answer.practice}</p>
              </div>
            )}
            {exchange.answer.gap && exchange.answer.status === 'answered' && (
              <p className="text-sm">{exchange.answer.gap}</p>
            )}
            {exchange.answer.sources.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold">{translate('sources')}</h3>
                {exchange.answer.sources.map((source, index) => (
                  <details
                    key={source.id}
                    id={`${prefix}-${exchange.id}-${source.id}`}
                    className="rounded-lg border border-border p-3"
                  >
                    <summary className="min-h-11 cursor-pointer font-medium">
                      [{index + 1}] {source.title} · {source.locator}
                    </summary>
                    <div className="space-y-3 pt-3 text-sm">
                      <p>{source.author}</p>
                      <p>{source.license}</p>
                      {source.historical && <p>{translate('historical')}</p>}
                      <blockquote className="border-l-2 border-border pl-3">
                        {source.excerpt}
                      </blockquote>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center underline"
                      >
                        {translate('openSource')}
                      </a>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={`${prefix}-medium`} className="block font-medium">
            {translate('medium')}
          </label>
          <select
            id={`${prefix}-medium`}
            value={medium ?? ''}
            disabled={pending}
            onChange={(event) =>
              setMedium((event.target.value || null) as LearningRequest['medium'])
            }
            className="min-h-11 w-full rounded-lg border border-input bg-background px-3"
          >
            <option value="">{translate('anyMedium')}</option>
            {(
              [
                'graphite',
                'charcoal',
                'ink',
                'coloured-pencil',
                'watercolour',
                'acrylic',
                'oil',
              ] as const
            ).map((value) => (
              <option key={value} value={value}>
                {intake(`media.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor={`${prefix}-question`} className="block font-medium">
            {translate('question')}
          </label>
          <textarea
            id={`${prefix}-question`}
            value={question}
            disabled={pending}
            onChange={(event) => setQuestion(event.target.value)}
            minLength={3}
            maxLength={2000}
            required
            rows={4}
            aria-describedby={`${prefix}-hint`}
            className="w-full rounded-lg border border-input bg-background p-3 focus-visible:outline-2 focus-visible:outline-ring"
          />
          <p id={`${prefix}-hint`} className="text-sm text-muted-foreground">
            {translate('hint')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={pending || question.trim().length < 3}
            className="min-h-11 px-5"
          >
            {translate(pending ? 'asking' : 'ask')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !exchanges.length}
            className="min-h-11"
            onClick={() => {
              setExchanges([]);
              setError(null);
            }}
          >
            {translate('clear')}
          </Button>
        </div>
        <output className="block" aria-live="polite">
          {pending ? translate('asking') : !error && exchanges.length ? translate('ready') : ''}
        </output>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
  );
};
