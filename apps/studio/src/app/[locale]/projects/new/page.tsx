import { getTranslations } from 'next-intl/server';
import { IntakeForm } from '@/components/intake/intake-form';

/**
 * Intake (FR-101, FR-102) — the first artist-facing surface in front of `POST /api/projects`.
 *
 * A server component holding the heading copy, with the form itself as the one client island.
 * Gating is not declared here and cannot be: `proxy.ts` matches on the path, so this page is
 * artist-only by virtue of living under `[locale]`, and the row it adds to
 * `src/__snapshots__/route-gate-matrix.md` is where that is checked.
 */
const NewProjectPage = async () => {
  const ti = await getTranslations('intake');

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{ti('title')}</h1>
        <p className="text-sm text-muted-foreground">{ti('description')}</p>
      </div>
      <IntakeForm />
    </div>
  );
};

export default NewProjectPage;
