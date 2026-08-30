# @artloupe/fascia

Art Loupe's shared UI library — the visible, crafted surface.

In automotive design, the *fascia* is the front trim and dashboard panel: the
designed surface a driver interacts with. In this monorepo, `@artloupe/fascia` is
the same idea for software — the typography, color tokens, and primitive
components (buttons, inputs, dialogs, alerts) that carry Art Loupe's visual
identity across its surfaces — the entry point, the artist studio, and the
operational dashboard.

## What lives here

- `src/lib/utils.ts` — `cn()` (tailwind-merge + clsx)
- `src/components/ui/*` — shadcn / base-ui **primitives** wrapped with Art Loupe defaults
- `src/components/blocks/*` — **presentational composites** built from the primitives
  (e.g. `LandingHero`, `ConsentCheckbox`, `LoginForm`). Reusable across apps;
  copy, state, and `action`s are passed in by the consumer — never baked in.

## What does *not* live here

- App-specific layout (header, footer, navigation) — those live in each app
- Application state, routing, auth logic — out of scope for a UI lib. A block may
  hold UI-local interaction state, but it never owns app state or talks to `@artloupe/auth`.
- Locale strings — apps own their own i18n; blocks take copy as props

The `no-fascia-to-app` rule in `.dependency-cruiserrc.mjs` enforces this.

## Consumer setup

In any consuming app:

```jsonc
// package.json
"dependencies": {
  "@artloupe/fascia": "workspace:*"
}
```

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ['@artloupe/fascia'],
  // ...
};
```

Then import:

```tsx
import { Button } from '@artloupe/fascia/components/ui/button';
import { cn } from '@artloupe/fascia/lib/utils';
```
