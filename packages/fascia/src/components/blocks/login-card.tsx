import { Card } from '@artloupe/fascia/components/ui/card';
import { cn } from '@artloupe/fascia/lib/utils';
import type { ReactNode } from 'react';
import { BrandLogo } from './brand-logo';

interface LoginCardProps {
  /** Organisation wordmark, set beside the mark — "Art Loupe". Omit for no lockup. */
  orgName?: string;
  /** Surface name, prefixed to the card's heading — "Artist Studio". */
  appName?: string;
  /** The rest of the card's heading, after the app name — "Log In". */
  title: ReactNode;
  /** Supporting copy beneath the heading. */
  description?: ReactNode;
  /** The login form itself. */
  children: ReactNode;
  /**
   * Full-bleed layer painted behind the card — a photo for one app, a gradient
   * for another. Rendered first and positioned by the caller; the card is a
   * later positioned sibling, so it stacks above without a z-index.
   */
  backdrop?: ReactNode;
  className?: string;
}

/**
 * `"Art Loupe"` → `['Art', 'Loupe']`. A single-word name yields one line
 * and the second is simply not rendered.
 */
const splitAtFirstSpace = (value: string): string[] => {
  const boundary = value.indexOf(' ');
  return boundary === -1
    ? [value]
    : [value.slice(0, boundary), value.slice(boundary + 1).trimStart()];
};

/**
 * The login screen template shared by all three apps. Holds no copy, auth logic, or
 * routing — the app supplies the strings, the form and the backdrop.
 *
 * The card surface is deliberately **solid** (`bg-card`, not a translucent tint):
 * the studio backdrop puts the card over the photo's horizon band, its
 * highest-contrast region, and the spec settles that no text may sit on the photo. Every
 * string here therefore renders on `--card`, a pairing the contrast gate already
 * measures — a translucent card would put the text on a surface `PAIRS` cannot see,
 * because it reads tokens and an image has none.
 *
 * **The page has one heading: `"<appName> - <title>"` as the card's `<h1>`.** The app
 * name is what distinguishes the three surfaces, so it has to be in the outline —
 * "Log In" alone would give all three the same page title. Carrying both in a single
 * `<h1>` keeps that distinction without splitting a login screen into a two-level
 * outline over what is really one form. With no `appName` the heading is just `title`.
 *
 * The organisation name stays out of the outline entirely: it is the same identity the
 * header already carries, repeated at display size because a login screen is often the
 * first page a visitor sees, and one label does not need two document outlines.
 */
const LoginCard = ({
  orgName,
  appName,
  title,
  description,
  children,
  backdrop,
  className,
}: LoginCardProps) => {
  // First word above the rest, mirroring the artwork's stacked lockup. Split rather than
  // taken as two props because `orgName` is one string everywhere else it appears — the
  // header renders it inline — and a second prop would be a second place to keep it right.
  const orgNameLines = orgName ? splitAtFirstSpace(orgName) : [];

  return (
    <div
      className={cn(
        'relative flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4 py-12',
        className,
      )}
    >
      {backdrop}
      {orgName ? (
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
                {orgNameLines[0]}
              </span>
              {orgNameLines[1] ? (
                <span
                  aria-hidden="true"
                  className="mt-1 block font-semibold text-3xl tracking-tight"
                >
                  {orgNameLines[1]}
                </span>
              ) : null}
              <span className="sr-only">{orgName}</span>
            </span>
          </div>
        </div>
      ) : null}
      <Card className="relative w-full max-w-md gap-6 px-6 py-8 sm:px-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-heading font-semibold text-2xl tracking-tight sm:text-3xl">
            {/* Guarded: without it a card given no `appName` opens on a stray "- ". */}
            {appName ? `${appName} - ` : null}
            {title}
          </h1>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {children}
      </Card>
    </div>
  );
};

export { LoginCard };
