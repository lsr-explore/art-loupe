'use client';

import { ConsentCheckbox } from '@artloupe/fascia/components/blocks/consent-checkbox';
import { Badge } from '@artloupe/fascia/components/ui/badge';
import { Button } from '@artloupe/fascia/components/ui/button';
import { useTranslations } from 'next-intl';
import { type FormEvent, useId, useRef, useState } from 'react';
import { acknowledgeAndLaunch } from '@/app/[locale]/actions';
import { LAUNCH_TARGETS, type LaunchTarget } from '@/lib/launch-targets';

/**
 * Which scoped token block each panel renders in (see globals.css).
 *
 * Studio is intentionally empty: entry's own skin *is* the studio skin, so the
 * panel inherits the ambient tokens and no `.theme-studio` block exists to apply.
 */
const PANEL_THEME: Record<LaunchTarget, string> = {
  studio: '',
  operations: 'theme-operations',
};

/** Only Operations carries the access badge. */
const HAS_ACCESS_BADGE: Record<LaunchTarget, boolean> = {
  studio: false,
  operations: true,
};

interface LaunchPanelsProps {
  /**
   * A validated resume URL from `?next=`, or undefined. Already checked against
   * the origin allowlist by the server — this component only forwards it.
   */
  next?: string;
  /**
   * Whether the acknowledgement cookie is already set. Resolved on the server —
   * the cookie is httpOnly, so this component has no way to look it up itself.
   */
  defaultAcknowledged?: boolean;
}

/**
 * The launch panels behind the synthetic-data acknowledgement — one per surface in
 * `LAUNCH_TARGETS`, currently studio and operations.
 *
 * The column count tracks that list: a fixed `lg:grid-cols-3` survived the strip from the
 * three-surface scaffold and left the two panels sitting in the left two tracks of three,
 * visibly off-centre. Two columns is the count, not a breakpoint tweak — revisit it when a
 * third target lands, not before.
 *
 * One form, one submit button per panel distinguished by `name="target"`, so the browser
 * reports which panel was clicked without any per-panel handler. Submission goes
 * to a server action, which re-checks the acknowledgement — the checks here are
 * the experience, not the enforcement.
 *
 * Buttons stay **enabled** while unacknowledged. A disabled button announces
 * nothing and gives the user nothing to act on; an enabled one that explains itself
 * on activation is what tells a screen-reader user *why* they cannot proceed.
 */
export const LaunchPanels = ({ next, defaultAcknowledged = false }: LaunchPanelsProps) => {
  const te = useTranslations('entry');
  const [rejected, setRejected] = useState(false);
  const acknowledgeRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();
  const checkboxId = useId();

  // `ConsentCheckbox` is a controlled component, so the page owns this. It is also
  // what the submit guard reads, which is why the posted field is derived from it
  // rather than from a second, independently-checkable native input.
  const [acknowledged, setAcknowledged] = useState(defaultAcknowledged);

  const guardSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (acknowledged) {
      return;
    }
    // jsdom does not implement native constraint validation on submit, and the repo
    // already hit this in the studio forms — so the guard is explicit JS, not
    // `required` on the input.
    event.preventDefault();
    setRejected(true);
    acknowledgeRef.current?.focus();
  };

  return (
    <form action={acknowledgeAndLaunch} onSubmit={guardSubmit} className="flex flex-col gap-8">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="flex flex-col gap-3">
        {/*
          Rendered only when rejected, so the alert fires on insertion. A permanently
          present, visually hidden live region would announce on every state change
          and is the usual reason these read twice.
        */}
        {rejected ? (
          <p
            id={errorId}
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-[color-mix(in_oklab,var(--destructive),black_22%)] dark:text-[color-mix(in_oklab,var(--destructive),white_12%)]"
          >
            {te('gate.error')}
          </p>
        ) : null}

        <ConsentCheckbox
          ref={acknowledgeRef}
          id={checkboxId}
          checked={acknowledged}
          onCheckedChange={(checked) => {
            setAcknowledged(checked);
            if (checked) {
              setRejected(false);
            }
          }}
          invalid={rejected}
          describedBy={errorId}
          label={te.rich('gate.label', {
            info: (chunks) => (
              // A plain anchor, not the locale-aware Link: the About site is
              // English-only, so a /es/about URL would 404.
              <a
                href="/about#synthetic-data"
                className="font-medium text-primary underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        />
        {/*
          The native input the server action reads. base-ui's Checkbox renders its
          own hidden input, but it is not inside this form's data unless named —
          keeping an explicit one makes the posted field obvious at the call site.
        */}
        <input type="hidden" name="acknowledged" value={acknowledged ? 'on' : ''} />
      </div>

      <ul className="grid gap-4 sm:grid-cols-2">
        {LAUNCH_TARGETS.map((target) => (
          <li
            key={target}
            className={`${PANEL_THEME[target]} flex flex-col gap-4 rounded-xl bg-card p-5 text-left text-card-foreground ring-1 ring-foreground/10`}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-heading font-medium text-base text-card-foreground">
                  {te(`panels.${target}.title`)}
                </h2>
                {HAS_ACCESS_BADGE[target] ? (
                  <Badge variant="secondary">{te('panels.operations.badge')}</Badge>
                ) : null}
              </div>
              <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
                {te(`panels.${target}.description`)}
              </p>
            </div>

            <Button type="submit" name="target" value={target} size="sm" className="mt-auto w-full">
              {te(`panels.${target}.cta`)}
            </Button>
          </li>
        ))}
      </ul>
    </form>
  );
};
