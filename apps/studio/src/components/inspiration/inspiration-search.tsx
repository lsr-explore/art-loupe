'use client';
import { ImageMetadataCard } from '@artloupe/fascia/components/blocks/image-metadata-card';
import { Button } from '@artloupe/fascia/components/ui/button';
import { Input } from '@artloupe/fascia/components/ui/input';
import { Label } from '@artloupe/fascia/components/ui/label';
import { NativeSelect } from '@artloupe/fascia/components/ui/native-select';
import { type InspirationRequest, inspirationRequestSchema } from '@artloupe/schemas/inspiration';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { type ComponentProps, useState } from 'react';
import { type ResultSort, visibleResults } from '@/lib/inspiration/results';
import { fetchInspiration, SearchError } from '@/lib/inspiration/search';
import { useSearchInput } from './use-search-input';

const initial: InspirationRequest = {
  source: 'pexels',
  query: '',
  artist: '',
  orientation: '',
  size: '',
  color: '',
  date_begin: null,
  date_end: null,
  highlights: false,
  page: 1,
};
const linkClass =
  'inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground';
const Field = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);
const TextInput = (props: ComponentProps<typeof Input>) => (
  <Input
    className="min-h-11 border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
    {...props}
  />
);

export const InspirationSearch = () => {
  const translate = useTranslations('inspiration');
  const locale = useLocale();
  const { draft, setDraft, committed, commit, replace } = useSearchInput(initial);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<ResultSort>('provider');
  const valid = inspirationRequestSchema.safeParse(committed);
  const search = useInfiniteQuery({
    queryKey: ['inspiration', valid.success ? valid.data : committed],
    enabled: valid.success,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchInspiration({ ...(valid.success ? valid.data : committed), page: pageParam }, signal),
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });
  const update = <K extends keyof InspirationRequest>(key: K, value: InspirationRequest[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  const visible = visibleResults(items, filter, sort, locale);
  const invalidDates =
    (draft.date_begin === null) !== (draft.date_end === null) ||
    (draft.date_begin !== null && draft.date_end !== null && draft.date_begin > draft.date_end);
  const errors =
    search.error instanceof SearchError
      ? search.error.status === 401
        ? translate('sessionEnded')
        : search.error.status === 429
          ? translate('rateLimited')
          : translate('unavailable')
      : translate('unavailable');
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{translate('title')}</h1>
        <p>{translate('description')}</p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="inspiration-source" label={translate('source')}>
            <NativeSelect
              id="inspiration-source"
              value={draft.source}
              onChange={(event) => {
                replace({
                  ...initial,
                  source: event.target.value as InspirationRequest['source'],
                  query: draft.query,
                });
                setSort('provider');
                setFilter('');
              }}
            >
              <option value="pexels">Pexels</option>
              <option value="met">{translate('met')}</option>
            </NativeSelect>
          </Field>
          <Field id="inspiration-query" label={translate('keywords')}>
            <TextInput
              id="inspiration-query"
              type="search"
              maxLength={150}
              value={draft.query}
              onChange={(event) => update('query', event.target.value)}
            />
          </Field>
        </div>
        <fieldset className="rounded-xl border border-foreground p-4">
          <legend className="px-2 font-semibold">{translate('requestFilters')}</legend>
          {draft.source === 'pexels' ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="inspiration-orientation" label={translate('orientation')}>
                <NativeSelect
                  id="inspiration-orientation"
                  value={draft.orientation}
                  onChange={(event) =>
                    update('orientation', event.target.value as InspirationRequest['orientation'])
                  }
                >
                  {['', 'landscape', 'portrait', 'square'].map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="inspiration-size" label={translate('size')}>
                <NativeSelect
                  id="inspiration-size"
                  value={draft.size}
                  onChange={(event) =>
                    update('size', event.target.value as InspirationRequest['size'])
                  }
                >
                  {['', 'small', 'medium', 'large'].map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="inspiration-color" label={translate('color')}>
                <NativeSelect
                  id="inspiration-color"
                  value={draft.color}
                  onChange={(event) =>
                    update('color', event.target.value as InspirationRequest['color'])
                  }
                >
                  {[
                    '',
                    'red',
                    'orange',
                    'yellow',
                    'green',
                    'turquoise',
                    'blue',
                    'violet',
                    'pink',
                    'brown',
                    'black',
                    'gray',
                    'white',
                  ].map((value) => (
                    <option key={value} value={value}>
                      {translate(value || 'any')}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="inspiration-artist" label={translate('artistSearch')}>
                <TextInput
                  id="inspiration-artist"
                  maxLength={100}
                  value={draft.artist}
                  onChange={(event) => update('artist', event.target.value)}
                />
              </Field>
              <div className="flex min-h-11 items-center gap-3">
                <input
                  className="size-6 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                  id="inspiration-highlights"
                  type="checkbox"
                  checked={draft.highlights}
                  onChange={(event) => update('highlights', event.target.checked)}
                />
                <Label htmlFor="inspiration-highlights">{translate('highlights')}</Label>
              </div>
              <Field id="inspiration-date-begin" label={translate('dateBegin')}>
                <TextInput
                  id="inspiration-date-begin"
                  type="number"
                  min={-5000}
                  max={2100}
                  aria-invalid={invalidDates}
                  aria-describedby="inspiration-dates-hint"
                  value={draft.date_begin ?? ''}
                  onChange={(event) =>
                    update(
                      'date_begin',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <Field id="inspiration-date-end" label={translate('dateEnd')}>
                <TextInput
                  id="inspiration-date-end"
                  type="number"
                  min={-5000}
                  max={2100}
                  aria-invalid={invalidDates}
                  aria-describedby="inspiration-dates-hint"
                  value={draft.date_end ?? ''}
                  onChange={(event) =>
                    update(
                      'date_end',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                />
              </Field>
              <p id="inspiration-dates-hint" className="sm:col-span-2">
                {translate('datesHint')}
              </p>
            </div>
          )}
        </fieldset>
        <Button
          className="min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          type="submit"
          disabled={!inspirationRequestSchema.safeParse(draft).success}
        >
          {translate('search')}
        </Button>
      </form>
      {draft.source === 'pexels' ? (
        <a className={linkClass} href="https://www.pexels.com">
          {translate('pexelsCredit')}
        </a>
      ) : null}
      <section aria-label={translate('results')} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="inspiration-filter" label={translate('filterLoaded')}>
            <TextInput
              id="inspiration-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </Field>
          <Field id="inspiration-sort" label={translate('sortLoaded')}>
            <NativeSelect
              id="inspiration-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as ResultSort)}
            >
              {(draft.source === 'met'
                ? ['provider', 'title', 'creator', 'oldest', 'newest']
                : ['provider', 'title', 'creator']
              ).map((value) => (
                <option key={value} value={value}>
                  {translate(value === 'title' ? 'titleSort' : value)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">
          {!valid.success
            ? invalidDates
              ? translate('datesHint')
              : translate('start')
            : search.isFetching
              ? translate('loading')
              : translate('count', { count: visible.length })}
        </p>
        {search.isError ? (
          <div role="alert" className="space-y-3 rounded-xl border border-foreground p-4">
            <p>{errors}</p>
            {items.length ? <p>{translate('retained')}</p> : null}
            <Button
              className="min-h-11"
              variant="outline"
              disabled={search.isFetching}
              onClick={() => void search.refetch()}
            >
              {translate('retry')}
            </Button>
          </div>
        ) : null}
        {search.data?.pages.some((page) => page.stale) ? <p>{translate('stale')}</p> : null}
        {search.data?.pages.some((page) => page.partial) ? (
          <div>
            <p>{translate('partial')}</p>
            <Button
              className="min-h-11"
              variant="outline"
              disabled={search.isFetching}
              onClick={() => void search.refetch()}
            >
              {translate('retry')}
            </Button>
          </div>
        ) : null}
        {search.isSuccess && !search.isFetching && !visible.length ? (
          <p>{items.length ? translate('noLocalMatches') : translate('empty')}</p>
        ) : null}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <ImageMetadataCard
              key={item.id}
              imageUrl={item.image_url}
              title={item.title}
              alt={item.alt}
              unavailableLabel={translate('imageUnavailable')}
              metadata={[
                ...(item.creator
                  ? [
                      {
                        label: translate(item.source === 'pexels' ? 'photographer' : 'artist'),
                        value: item.creator,
                      },
                    ]
                  : []),
                ...(item.medium ? [{ label: translate('artMedium'), value: item.medium }] : []),
                ...(item.date ? [{ label: translate('painted'), value: item.date }] : []),
              ]}
              credit={
                item.source === 'pexels' ? (
                  <a className={linkClass} href={item.source_url}>
                    {translate('photoCredit', { name: item.creator ?? 'Pexels' })}
                  </a>
                ) : undefined
              }
            />
          ))}
        </div>
        {search.hasNextPage ? (
          <Button
            className="min-h-11"
            variant="outline"
            disabled={search.isFetching}
            onClick={() => void search.fetchNextPage()}
          >
            {translate('loadMore')}
          </Button>
        ) : null}
        {search.data && !search.hasNextPage && items.length ? <p>{translate('end')}</p> : null}
        <p className="text-sm">{translate('loadedHint')}</p>
      </section>
    </div>
  );
};
