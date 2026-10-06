// Fascia supports React without Next.js; providers return sized thumbnails.
/* eslint-disable @next/next/no-img-element */
'use client';
import { type ReactNode, useState } from 'react';

export interface ImageMetadataCardProps {
  imageUrl: string;
  alt: string;
  title: string;
  unavailableLabel: string;
  metadata: { label: string; value: string }[];
  credit?: ReactNode;
}

/** A figure is intentionally non-interactive until an actual destination exists. */
export const ImageMetadataCard = ({
  imageUrl,
  alt,
  title,
  unavailableLabel,
  metadata,
  credit,
}: ImageMetadataCardProps) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted p-2">
        {failedUrl === imageUrl ? (
          <p className="p-4 text-center">{unavailableLabel}</p>
        ) : (
          // biome-ignore lint/performance/noImgElement: Fascia is framework-independent; provider thumbnails are already sized.
          <img
            src={imageUrl}
            alt={alt}
            loading="lazy"
            decoding="async"
            width={480}
            height={360}
            className="h-full w-full object-contain"
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
