import { BrandLogo } from '@artloupe/fascia/components/blocks/brand-logo';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { LaunchPanels } from '@/components/entry/launch-panels';
import { ACK_COOKIE_NAME } from '@/lib/ack-cookie';
import { resolveNextUrl } from '@/lib/app-origins';

interface EntryPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * The entry point: the launch panels behind a synthetic-data acknowledgement.
 *
 * The disclaimer note this page used to render moved into `<AppShell>`'s demo banner,
 * which shows it on every page of every surface — keeping it here too would
 * show it twice. What lives here is the *gate*, not a second notice. The mark stays,
 * at display size: the header's is 28px chrome, this is the page's own subject.
 *
 * `idPrefix` because the header also renders a `<BrandLogo />` on this page, and
 * the default prefix would emit duplicate gradient and mask ids.
 */
const EntryPage = async ({ searchParams }: EntryPageProps) => {
  const te = await getTranslations('entry');
  const { next } = await searchParams;

  // Validated server-side rather than in the client component: the allowlist is the
  // security boundary, and a value that fails it should never reach the browser as a
  // form field at all.
  const resumeTo = resolveNextUrl(next);

  // Reflect the gate's existing state rather than re-asking. The cookie is httpOnly,
  // so the checkbox cannot read it itself — the server has to hand the answer down.
  // It stays session-scoped: a visitor who closes the browser still re-consents,
  // which is the decision. Re-ticking it on every launch within one session was not.
  const cookieStore = await cookies();
  const acknowledged = cookieStore.has(ACK_COOKIE_NAME);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="relative flex flex-col items-center gap-3 text-center">
          {/*
            Mark and wordmark side by side, the wordmark stacked over two lines and the
            mark sized to span both — the proportions of the supplied lockup.

            The wordmark is HTML text beside the SVG rather than baked into the asset,
            so it stays selectable, scales with the type, and needs no second file
            per theme. `idPrefix` because the header renders a `<BrandLogo />` on this
            page too, and the default prefix would emit duplicate gradient and mask ids.
          */}
          <div className="flex items-center gap-4">
            <BrandLogo className="h-20" idPrefix="login-hero" />
            <span className="font-heading text-foreground leading-none">
              {/*
                The visual split is presentational, and the accessible name is supplied
                whole. Two block children would otherwise leave the computed name to
                implementation-specific whitespace handling, which is how a lockup ends
                up announced as "ArtLoupe".
              */}
              <span aria-hidden="true" className="block font-semibold text-3xl tracking-tight">
                Art
              </span>
              <span aria-hidden="true" className="mt-1 block font-semibold text-3xl tracking-tight">
                Loupe
              </span>
              <span className="sr-only">Art Loupe</span>
            </span>
          </div>

          <div className="flex max-w-prose flex-col gap-3">
            <h1 className="text-balance font-semibold text-3xl text-foreground tracking-tight sm:text-4xl">
              {te('title')}
            </h1>
            <p className="text-pretty text-base text-muted-foreground leading-relaxed">
              {te('description')}
            </p>
          </div>
        </div>
      </div>

      <LaunchPanels next={resumeTo ?? undefined} defaultAcknowledged={acknowledged} />
    </div>
  );
};

export default EntryPage;
