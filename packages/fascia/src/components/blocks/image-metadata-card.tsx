// Fascia supports React without Next.js; providers return sized thumbnails.
/* oxlint-disable nextjs/no-img-element */
'use client';
import { type ReactNode, useState } from 'react';

export interface ImageMetadataCardProps {
  imageUrl: string;
  alt: string;
  title: string;
  unavailableLabel: string;
  metadata: { label: string; value: string }[];
  credit?: ReactNode;
  /**
   * `frame` (default) shows every image in the same 4:3 box, so rows line up.
   * `natural` keeps each image's own proportions, for masonry layouts. The width and
   * height attributes still reserve a 4:3 box until the image loads.
   */
  fit?: 'frame' | 'natural';
}

/** A figure is intentionally non-interactive until an actual destination exists. */
export const ImageMetadataCard = ({
  imageUrl,
  alt,
  title,
  unavailableLabel,
  metadata,
  credit,
  fit = 'frame',
}: ImageMetadataCardProps) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
      <div
        className={
          fit === 'frame'
            ? 'flex aspect-[4/3] items-center justify-center bg-muted p-2'
            : 'flex min-h-24 items-center justify-center bg-muted p-2'
        }
      >
        {failedUrl === imageUrl ? (
          <p className="p-4 text-center">{unavailableLabel}</p>
        ) : (
          <img
            src={imageUrl}
            alt={alt}
            loading="lazy"
            decoding="async"
            width={480}
            height={360}
            className={fit === 'frame' ? 'h-full w-full object-contain' : 'h-auto w-full'}
            onError={() => setFailedUrl(imageUrl)}
          />
        )}
      </div>
      <figcaption className="space-y-3 p-4">
        <h2 className="break-words text-lg font-semibold">{title}</h2>
        <dl className="space-y-2 text-sm">
          {metadata.map(({ label, value }) => (
            <div key={label}>
              <dt className="font-semibold">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        {credit}
      </figcaption>
    </figure>
  );
};
