'use client';
import type { GalleryLayout } from '@artloupe/fascia/components/blocks/gallery-layout';
import type { InspirationRequest } from '@artloupe/schemas/inspiration';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { type ResultSort, visibleResults } from '@/lib/inspiration/results';

import { InspirationResults } from './inspiration-results';
import { datesInvalid, InspirationSearchForm } from './inspiration-search-form';
import { ResultsToolbar } from './results-toolbar';
import { useInspirationResults } from './use-inspiration-results';
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
// Automatic search waits for a term long enough to be meaningful; shorter terms still
// search on submit. Every automatic request can spend the provider quota all artists share.
const AUTO_SEARCH_MIN_LENGTH = 3;
const longEnough = (value: string) => {
  const length = value.trim().length;
  return length === 0 || length >= AUTO_SEARCH_MIN_LENGTH;
};
const worthAutoSearch = (draft: InspirationRequest) =>
  longEnough(draft.query) && longEnough(draft.artist);

/**
 * The Get Inspired container. It owns three kinds of state and passes each down:
 * draft and committed request (`useSearchInput`), server state (`useInspirationResults`),
 * and view state (filter, sort, layout). The children render; none of them decides
 * when a request runs.
 */
export const InspirationSearch = () => {
  const translate = useTranslations('inspiration');
  const locale = useLocale();
  const { draft, setDraft, committed, commit, replace } = useSearchInput(initial, {
    shouldAutoCommit: worthAutoSearch,
  });
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<ResultSort>('provider');
  const [layout, setLayout] = useState<GalleryLayout>({ engine: 'grid', masonry: false });
  const results = useInspirationResults(committed);
  const { search, valid, items } = results;
  const visible = visibleResults(items, filter, sort, locale);

  // A short edit is held back from auto-search, so say which term the results belong to.
  // Name both fields when both are set, so editing only the artist still reads as a change.
  const describe = (request: InspirationRequest) => {
    const query = request.query.trim();
    const artist = request.artist.trim();
    return query && artist ? translate('termWithArtist', { query, artist }) : query || artist;
  };
  const heldBack =
    valid &&
    !worthAutoSearch(draft) &&
    (draft.query.trim() !== committed.query.trim() ||
      draft.artist.trim() !== committed.artist.trim());
  const status = !valid
    ? datesInvalid(draft)
      ? translate('datesHint')
      : translate('start')
    : search.isFetching
      ? translate('loading')
      : translate('count', { count: visible.length }) +
        (heldBack
          ? ` ${translate('earlierTerm', { previous: describe(committed), next: describe(draft) })}`
          : '');

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{translate('title')}</h1>
        <p>{translate('description')}</p>
      </header>
      <InspirationSearchForm
        draft={draft}
        onChange={(key, value) => setDraft((previous) => ({ ...previous, [key]: value }))}
        onSourceChange={(source) => {
          // Filters belong to one provider, so a new source starts clean and searches at once.
          replace({ ...initial, source, query: draft.query });
          setSort('provider');
          setFilter('');
        }}
        onSubmit={commit}
      />
      <InspirationResults
        results={results}
        visible={visible}
        status={status}
        layout={layout}
        toolbar={
          <ResultsToolbar
            source={draft.source}
            filter={filter}
            onFilterChange={setFilter}
            sort={sort}
            onSortChange={setSort}
            layout={layout}
            onLayoutChange={setLayout}
          />
        }
      />
    </div>
  );
};
