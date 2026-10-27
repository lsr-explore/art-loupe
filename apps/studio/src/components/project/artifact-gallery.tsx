'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { RunResult } from '@/lib/runs/run-contract';

type Artifact = RunResult['artifacts'][number];

const ArtifactCard = ({ projectId, artifact }: { projectId: string; artifact: Artifact }) => {
  const tr = useTranslations('project.artifacts');
  const tt = useTranslations('project.tools');
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const name = tt(artifact.tool);
  const recipe = new URLSearchParams({
    version: artifact.tool_version,
    checksum: artifact.source_checksum,
  });
  const url = `/api/projects/${projectId}/artifacts/${artifact.tool}?${recipe}`;
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-48 items-center justify-center bg-muted/30 p-3">
        {status === 'failed' ? (
          <div className="flex flex-col gap-3 p-4 text-sm" role="alert">
            <p>{tr('failed')}</p>
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                setStatus('loading');
                setAttempt((value) => value + 1);
              }}
            >
              {tr('retry')}
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            {status === 'loading' ? (
              <output className="text-sm text-muted-foreground">{tr('loading')}</output>
            ) : null}
            {/* Private image: keep it out of Next's shared image optimizer cache. */}
            {/* oxlint-disable-next-line nextjs/no-img-element */}
            <img
              key={attempt}
              src={`${url}&attempt=${attempt}`}
              alt={tr('alt', { tool: name })}
              loading="lazy"
              className="max-h-[32rem] w-full object-contain"
              onLoad={() => setStatus('ready')}
              onError={() => setStatus('failed')}
            />
          </div>
        )}
      </div>
      <figcaption className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="font-semibold">{name}</h3>
        {artifact.tool === 'perspective' || artifact.tool === 'head_construction' ? (
          <p className="text-xs text-muted-foreground">{tr('legend')}</p>
        ) : null}
        {artifact.confidence !== null ? (
          <p className="text-xs">
            {tr('confidence', { value: Math.round(artifact.confidence * 100) })}
          </p>
        ) : null}
        {artifact.limitations.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {artifact.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-4 text-sm">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center underline"
          >
            {tr('open')}
          </a>
          <a
            href={`${url}&download=1`}
            download={`${artifact.tool}.png`}
            className="inline-flex min-h-11 items-center underline"
          >
            {tr('download')}
          </a>
        </div>
      </figcaption>
    </figure>
  );
};

export const ArtifactGallery = ({
  projectId,
  artifacts,
}: {
  projectId: string;
  artifacts: RunResult['artifacts'];
}) => {
  const tr = useTranslations('project.artifacts');
  if (artifacts.length === 0) return null;
  return (
    <section aria-labelledby="artifacts-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="artifacts-heading" className="text-xl font-semibold">
          {tr('title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tr('description')}</p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {artifacts.map((artifact) => (
          <ArtifactCard key={artifact.tool} projectId={projectId} artifact={artifact} />
        ))}
      </div>
    </section>
  );
};
