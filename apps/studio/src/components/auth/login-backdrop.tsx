import Image from 'next/image';

/**
 * The photographic backdrop behind the studio login card.
 *
 * `alt=""` because it is decorative — it carries no information the login screen
 * does not already state, so announcing it would only add noise.
 *
 * The 0.75 is applied to the **image itself** rather than as a scrim over it,
 * which lets the page background token show through and keeps the same markup
 * working in light and dark.
 *
 * `preload` rather than `priority`: this is the LCP element, but Next 16 deprecated
 * `priority` in favour of `preload` to make the behaviour explicit. Both emit the
 * `<link rel="preload">`; only the new name survives the deprecation.
 *
 * Format conversion is the optimizer's job, not a build step — `images.formats` in
 * `next.config.ts` serves AVIF then WebP by `Accept`, falling back to the source
 * JPEG. No `sharp` step and no second copy of the asset in the repo.
 *
 * The asset is `portal-backdrop`, not `login-backdrop`: the same photograph goes
 * behind the signed-in portal cards, so the name describes the image rather than the
 * one screen that happened to use it first.
 */
export const LoginBackdrop = () => (
  <Image
    src="/portal-backdrop.jpg"
    alt=""
    fill
    sizes="100vw"
    preload
    className="object-cover opacity-75"
  />
);
