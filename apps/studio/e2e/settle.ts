import type { Page } from '@playwright/test';

/**
 * Waits for CSS transitions and enter animations to finish.
 *
 * Playwright's `toBeVisible()` resolves as soon as an element is painted, which is
 * the *start* of its animation, not the end — so anything asserted immediately after
 * is racing it. axe loses that race in a specific way: it measures composited pixels,
 * so a control mid-fade reports its blend with the backdrop rather than its token.
 *
 * That is what reddened `main` on 4afd97e. The Send button re-enabling from
 * `disabled:opacity-50` under `transition-all` was sampled at ~80% opacity, giving
 * `#fefcf8` on `#518ea3` for 3.56:1, when the settled pairing is
 * `--primary-foreground` on `--primary` and passes comfortably. WCAG 1.4.3 governs
 * settled states, not interpolated frames, so the wait belongs here rather than in
 * the palette or in `PAIRS`.
 *
 * Infinite animations are excluded — the loader spinner never reaches `finished`
 * and would hang the wait forever.
 */
export const settleTransitions = async (page: Page): Promise<void> => {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
      )
      .every((animation) => animation.playState === 'finished'),
  );
};

/**
 * Waits for a focus trap's redirect to land before focus is inspected.
 *
 * base-ui traps focus with sentinel guards placed *outside* the popup: tabbing off
 * the end moves focus onto a guard, and a handler then sends it back to the other
 * end. That round trip is asynchronous, so for one tick `document.activeElement` is
 * legitimately the guard and not inside the dialog.
 *
 * A `Tab` loop that asserts immediately does not merely observe that tick — it
 * *compounds* it. Pressing Tab again while focus still sits on the guard moves focus
 * onward into the page behind, so the test manufactures the escape it then reports.
 * That is what made the drawer's focus-trap spec intermittent across browsers and
 * green only on retry; the trap itself is sound, and settling here confirms focus
 * returns inside on every single Tab rather than trusting `retries` to hide it.
 */
export const settleFocus = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => !(document.activeElement as HTMLElement | null)?.hasAttribute('data-base-ui-focus-guard'),
  );
};
