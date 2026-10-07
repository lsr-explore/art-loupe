'use client';
import type { GalleryLayout } from '@artloupe/fascia/components/blocks/gallery-layout';
import { ImageGallery } from '@artloupe/fascia/components/blocks/image-gallery';
import { ImageMetadataCard } from '@artloupe/fascia/components/blocks/image-metadata-card';
import { Button } from '@artloupe/fascia/components/ui/button';
import type { InspirationImage } from '@artloupe/schemas/inspiration';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SearchError } from '@/lib/inspiration/search';
import { linkClass } from './form-fields';
import type { InspirationResults as Results } from './use-inspiration-results';

interface InspirationResultsProps {
  results: Results;
  /** Loaded results after local filtering and sorting. */
  visible: InspirationImage[];
  /** The polite status line; the parent decides what it says. */
  status: ReactNode;
  toolbar: ReactNode;
  layout: GalleryLayout;
}

/** Everything below the form: status, notices, the gallery, and pagination. */
export const InspirationResults = ({
  results: { search, items },
  visible,
  status,
  toolbar,
  layout,
}: InspirationResultsProps) => {
  const translate = useTranslations('inspiration');
  const error =
    search.error instanceof SearchError && search.error.status === 401
      ? translate('sessionEnded')
      : search.error instanceof SearchError && search.error.status === 429
        ? translate('rateLimited')
        : translate('unavailable');
  return (
    <section aria-label={translate('results')} className="space-y-4">
      {toolbar}
      <p role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
      {search.isError ? (
        <div role="alert" className="space-y-3 rounded-xl border border-foreground p-4">
          <p>{error}</p>
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
      <ImageGallery
        items={visible}
        getKey={(item) => item.id}
        layout={layout}
        label={translate('imageList')}
        renderItem={(item) => (
          <ImageMetadataCard
            imageUrl={item.image_url}
            title={item.title}
            alt={item.alt}
            fit={layout.masonry ? 'natural' : 'frame'}
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
        )}
      />
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
  );
};
