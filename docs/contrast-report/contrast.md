# Token contrast baseline

<!-- GENERATED FILE — do not edit by hand. Run `pnpm contrast:report`. -->

Measured WCAG 2.2 contrast for every design-token pairing the three apps actually
render, in both light and dark. Regenerate with `pnpm contrast:report`; verify without
writing with `pnpm contrast:check`.

This file is the **baseline** the next palette change is measured against: change an
anchor, rerun, and the diff shows exactly which pairings moved and by how much.

- **Source of values** — each app's `apps/<app>/src/app/globals.css`. `fascia` owns the
  token *contract*; the apps own the *values*.
- **Source of ratios** — `packages/fascia/src/theme/contrast.ts`, the same module
  `contrast.test.ts` asserts against, so this table and the build gate cannot disagree.
- **The gates** — `pnpm contrast:check` in CI, and `pnpm --filter @artloupe/fascia test`
  locally. Both fail on any asserted pairing below its bar.

## How to read it

| Kind | Wants | Asserted | Why |
| --- | --: | :-: | --- |
| body text | 4.5:1 | yes | WCAG 1.4.3 — normal-size text. |
| large text | 3:1 | yes | WCAG 1.4.3 — >=24px, or >=18.66px bold. |
| UI / graphical | 3:1 | yes | WCAG 1.4.11 — a control's boundary, a focus indicator, or a chart mark needed to read the data. |
| advisory | 3:1 | no | Measured against 3:1 and **warned** on, never failed. The page and card divider rules: exempt under 1.4.11, but the ones most likely to be doing real separating work, so they stay visible rather than silent. |
| decorative | n/a | no | Measured with no bar. 1.4.11 exempts purely aesthetic edges: a card's drop edge carries no information. Holding it to 3:1 would manufacture a failure and force every surface outline heavy. |

### Pass, warn, error

| Mark | Meaning |
| :-: | --- |
| ✅ | Clears what it wants by at least **0.25**. |
| ⚠️ | Clears it by less than 0.25, or is an advisory pairing below it. Does not fail CI. |
| ❌ | An asserted pairing below its bar. Fails CI. |
| · | Decorative — measured, unbarred. |

**Nothing is rounded before it is compared.** Ratios are quoted to two decimals, but the
comparison uses full precision, so a true 2.996:1 is an error and never a `3.00` that
reads as a pass. The 0.25 margin exists for the same reason from the other side: a
pairing at 3.09:1 is one anchor nudge away from failing, and calling that a clean pass
claims a confidence the number does not carry.

Three conventions worth knowing:

- **There is no separate "system" palette.** All three apps mount `next-themes` with
  `defaultTheme="system"` and `enableSystem`, so the system setting resolves to the same
  `:root` or `.dark` block measured below. Covering light and dark covers system; a third
  table would be the same numbers twice.
- Ratios are computed oklch → linear sRGB → 8-bit sRGB, then through the WCAG luminance
  formula. The round trip through 8 bits is deliberate — it is what the browser rasterises,
  so a number here matches what axe or devtools reports on the running app.
- `--destructive/10 over --card` style entries measure the **composited** surface. The
  destructive button and badge paint `bg-destructive/10`, never an opaque fill, so
  measuring the opaque token would report a contrast that never appears on screen.

## Summary

- **186 pairings** measured across 3 apps x 2 modes.
- **145 pass · 29 warn · 0 error**, plus 12 decorative pairings carrying no bar.
- **0 tokens outside the sRGB gamut.**

### Everything not a clean pass

Errors first, then asserted pairings sitting inside the margin, then the advisory
dividers. The advisory rows are last on purpose: they are a standing decision, not a
regression, so they should never sit above a pairing that is one anchor nudge from red.

| | App | Mode | Pairing | Kind | Ratio | Wants |
| :-: | --- | --- | --- | --- | --: | --: |
| ⚠️ | entry | dark | chart 1 on card | UI / graphical | 3.09:1 | 3:1 |
| ⚠️ | studio | dark | chart 1 on card | UI / graphical | 3.09:1 | 3:1 |
| ⚠️ | entry | light | link text on page | body text | 4.67:1 | 4.5:1 |
| ⚠️ | studio | light | link text on page | body text | 4.67:1 | 4.5:1 |
| ⚠️ | entry | light | muted text on muted surface | body text | 4.69:1 | 4.5:1 |
| ⚠️ | studio | light | muted text on muted surface | body text | 4.69:1 | 4.5:1 |
| ⚠️ | entry | dark | destructive text on tint (card) | body text | 4.69:1 | 4.5:1 |
| ⚠️ | studio | dark | destructive text on tint (card) | body text | 4.69:1 | 4.5:1 |
| ⚠️ | operations | light | input border on page | UI / graphical | 3.15:1 | 3:1 |
| ⚠️ | operations | light | destructive text on tint (page) | body text | 4.74:1 | 4.5:1 |
| ⚠️ | entry | light | input border on page | UI / graphical | 3.17:1 | 3:1 |
| ⚠️ | studio | light | input border on page | UI / graphical | 3.17:1 | 3:1 |
| ⚠️ | entry | dark | chart 4 on card | UI / graphical | 3.18:1 | 3:1 |
| ⚠️ | studio | dark | chart 4 on card | UI / graphical | 3.18:1 | 3:1 |
| ⚠️ | operations | dark | input border on card | UI / graphical | 3.18:1 | 3:1 |
| ⚠️ | entry | dark | input border on card | UI / graphical | 3.19:1 | 3:1 |
| ⚠️ | studio | dark | input border on card | UI / graphical | 3.19:1 | 3:1 |
| ⚠️ | operations | light | divider on page | advisory | 1.16:1 | 3:1 |
| ⚠️ | entry | light | divider on page | advisory | 1.20:1 | 3:1 |
| ⚠️ | studio | light | divider on page | advisory | 1.20:1 | 3:1 |
| ⚠️ | operations | light | divider on card | advisory | 1.35:1 | 3:1 |
| ⚠️ | entry | light | divider on card | advisory | 1.35:1 | 3:1 |
| ⚠️ | studio | light | divider on card | advisory | 1.35:1 | 3:1 |
| ⚠️ | operations | dark | divider on card | advisory | 1.37:1 | 3:1 |
| ⚠️ | entry | dark | divider on card | advisory | 1.48:1 | 3:1 |
| ⚠️ | studio | dark | divider on card | advisory | 1.48:1 | 3:1 |
| ⚠️ | operations | dark | divider on page | advisory | 1.51:1 | 3:1 |
| ⚠️ | entry | dark | divider on page | advisory | 1.69:1 | 3:1 |
| ⚠️ | studio | dark | divider on page | advisory | 1.69:1 | 3:1 |

## Provenance

| | |
| --- | --- |
| Generated | 2026-08-30 |
| Repo version | `0.1.0` |
| HEAD | *not a git checkout* |
| Working tree | *unknown* |
| Inputs fingerprint | `3122b533a9f072c6` |

The fingerprint is a SHA-256 over the exact bytes of every file that can change a
number below. It is what makes staleness detectable: `pnpm contrast:check` recomputes
it and tells you the doc needs regenerating, without diffing a file whose header
carries a date and therefore always differs. HEAD is recorded for human orientation —
it moves on commits that touch none of these files, so it is not the staleness signal.

| Input | sha256 |
| --- | --- |
| `apps/entry/src/app/globals.css` | `e1438426bdbda295` |
| `apps/studio/src/app/globals.css` | `ebf273eade213344` |
| `apps/operations/src/app/globals.css` | `7ea9f5604e156b3b` |
| `packages/fascia/src/theme/contrast.ts` | `a3081af6ddaca7e7` |
| `scripts/reports/contrast-report.mjs` | `1eacc53053160673` |

`docs/contrast-report/contrast.json` carries the same provenance plus every measured ratio, for
anything that wants the numbers without parsing markdown.

## Separation between the apps

Contrast answers "can this be read on that". It cannot see whether the apps still look
like *different products* — tuning each one toward its own brief in isolation can converge
them all on the same hue while every ratio above still passes. This section is that missing
measure: perceptual distance (ΔE in oklab) between the apps' identity tokens.

`entry` is excluded on purpose — it mirrors the studio skin by design, so measuring it
here would report a deliberate decision as a failure.

Primary hue spread across the three: **38°** light, **38°** dark.

| Token | Mode | Apps | ΔE | |
| --- | --- | --- | --: | :-: |
| `--background` | light | studio vs operations | 0.0429 | ✅ |
| `--background` | dark | studio vs operations | 0.0636 | ✅ |
| `--primary` | dark | studio vs operations | 0.1202 | ✅ |
| `--primary` | light | studio vs operations | 0.1506 | ✅ |

The floor is **0.025**, and it is deliberately low: a "did something collapse"
guard, not a design bar. Whether the apps feel distinct enough is a judgement call for a human
looking at them. The values live in each app's `src/app/globals.css`; rerun this report after changing any of them.

## entry

Public apex holding page. Mirrors the studio skin so the first and second screens feel continuous.

### entry — light

29 measured pairings, 0 failing, 5 warning. Tightest sits at 40% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(96% 0.024 88deg)` | `#f8f1e0` |
| `--foreground` | `oklch(30.4% 0.0237 233.61deg)` | `#233139` |
| `--primary` | `oklch(52.5% 0.088 228deg)` | `#257492` |
| `--accent` | `oklch(92.8% 0.026 228deg)` | `#d6ebf5` |
| `--input` | `oklch(62.5% 0.0312 88deg)` | `#8f8773` |
| `--border` | `oklch(89.9% 0.0312 88deg)` | `#e6ddc7` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 11.88:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 13.38:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 13.38:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 10.96:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 10.87:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 5.08:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 5.72:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 4.69:1 | 4.5:1 | ⚠️ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 5.26:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 4.67:1 | 4.5:1 | ⚠️ |
| link text on card | `--primary` | `--card` | body text | 5.26:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 4.88:1 | 4.5:1 | ✅ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 5.44:1 | 4.5:1 | ✅ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 13.38:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 5.26:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 10.87:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.17:1 | 3:1 | ⚠️ |
| input border on card | `--input` | `--card` | UI / graphical | 3.57:1 | 3:1 | ✅ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 4.67:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 5.26:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 5.26:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 4.62:1 | 3:1 | ✅ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 3.48:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 3.33:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 4.49:1 | 3:1 | ✅ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 4.16:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.20:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.35:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.13:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.35:1 | n/a | · |

### entry — dark

29 measured pairings, 0 failing, 6 warning. Tightest sits at 49% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(24% 0.03 215deg)` | `#0c2328` |
| `--foreground` | `oklch(94.5% 0.011 215deg)` | `#e5eff1` |
| `--primary` | `oklch(74% 0.105 228deg)` | `#5ab8df` |
| `--accent` | `oklch(35% 0.0375 215deg)` | `#224047` |
| `--input` | `oklch(56.5% 0.036 215deg)` | `#5e7c83` |
| `--border` | `oklch(38.5% 0.036 215deg)` | `#2c4950` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 13.95:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 12.21:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 12.21:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 9.48:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 6.88:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 6.02:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 5.31:1 | 4.5:1 | ✅ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 7.17:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 7.27:1 | 4.5:1 | ✅ |
| link text on card | `--primary` | `--card` | body text | 6.36:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 5.38:1 | 4.5:1 | ✅ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 4.69:1 | 4.5:1 | ⚠️ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 12.21:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 7.17:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 9.48:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.64:1 | 3:1 | ✅ |
| input border on card | `--input` | `--card` | UI / graphical | 3.19:1 | 3:1 | ⚠️ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 7.27:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 6.36:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 6.36:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 3.09:1 | 3:1 | ⚠️ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 4.11:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 4.29:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 3.18:1 | 3:1 | ⚠️ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 3.43:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.69:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.48:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.14:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.48:1 | n/a | · |

## studio

Soft welcoming light blues on warm sand — the softest, roundest of the skins.

### studio — light

29 measured pairings, 0 failing, 5 warning. Tightest sits at 40% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(96% 0.024 88deg)` | `#f8f1e0` |
| `--foreground` | `oklch(30.4% 0.0237 233.61deg)` | `#233139` |
| `--primary` | `oklch(52.5% 0.088 228deg)` | `#257492` |
| `--accent` | `oklch(92.8% 0.026 228deg)` | `#d6ebf5` |
| `--input` | `oklch(62.5% 0.0312 88deg)` | `#8f8773` |
| `--border` | `oklch(89.9% 0.0312 88deg)` | `#e6ddc7` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 11.88:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 13.38:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 13.38:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 10.96:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 10.87:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 5.08:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 5.72:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 4.69:1 | 4.5:1 | ⚠️ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 5.26:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 4.67:1 | 4.5:1 | ⚠️ |
| link text on card | `--primary` | `--card` | body text | 5.26:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 4.88:1 | 4.5:1 | ✅ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 5.44:1 | 4.5:1 | ✅ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 13.38:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 5.26:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 10.87:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.17:1 | 3:1 | ⚠️ |
| input border on card | `--input` | `--card` | UI / graphical | 3.57:1 | 3:1 | ✅ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 4.67:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 5.26:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 5.26:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 4.62:1 | 3:1 | ✅ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 3.48:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 3.33:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 4.49:1 | 3:1 | ✅ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 4.16:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.20:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.35:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.13:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.35:1 | n/a | · |

### studio — dark

29 measured pairings, 0 failing, 6 warning. Tightest sits at 49% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(24% 0.03 215deg)` | `#0c2328` |
| `--foreground` | `oklch(94.5% 0.011 215deg)` | `#e5eff1` |
| `--primary` | `oklch(74% 0.105 228deg)` | `#5ab8df` |
| `--accent` | `oklch(35% 0.0375 215deg)` | `#224047` |
| `--input` | `oklch(56.5% 0.036 215deg)` | `#5e7c83` |
| `--border` | `oklch(38.5% 0.036 215deg)` | `#2c4950` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 13.95:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 12.21:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 12.21:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 10.76:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 9.48:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 6.88:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 6.02:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 5.31:1 | 4.5:1 | ✅ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 7.17:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 7.27:1 | 4.5:1 | ✅ |
| link text on card | `--primary` | `--card` | body text | 6.36:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 5.38:1 | 4.5:1 | ✅ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 4.69:1 | 4.5:1 | ⚠️ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 12.21:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 7.17:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 9.48:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.64:1 | 3:1 | ✅ |
| input border on card | `--input` | `--card` | UI / graphical | 3.19:1 | 3:1 | ⚠️ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 7.27:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 6.36:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 6.36:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 3.09:1 | 3:1 | ⚠️ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 4.11:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 4.29:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 3.18:1 | 3:1 | ⚠️ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 3.43:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.69:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.48:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.14:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.48:1 | n/a | · |

## operations

Deep marine and high density, with cyan leading the status and chart marks.

### operations — light

29 measured pairings, 0 failing, 4 warning. Tightest sits at 39% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(95% 0.018 255deg)` | `#e7effb` |
| `--foreground` | `oklch(30.4% 0.0369 249.33deg)` | `#203041` |
| `--primary` | `oklch(41% 0.15 266deg)` | `#24419a` |
| `--accent` | `oklch(92.8% 0.026 266deg)` | `#dfe7f9` |
| `--input` | `oklch(62% 0.0234 255deg)` | `#7d8794` |
| `--border` | `oklch(89.9% 0.0234 255deg)` | `#d4dfed` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 11.62:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 13.46:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 13.46:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 10.77:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 11.07:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 10.85:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 5.09:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 5.90:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 4.85:1 | 4.5:1 | ✅ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 9.14:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 7.89:1 | 4.5:1 | ✅ |
| link text on card | `--primary` | `--card` | body text | 9.14:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 4.74:1 | 4.5:1 | ⚠️ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 5.44:1 | 4.5:1 | ✅ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 13.46:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 9.14:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 10.85:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.15:1 | 3:1 | ⚠️ |
| input border on card | `--input` | `--card` | UI / graphical | 3.64:1 | 3:1 | ✅ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 7.89:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 9.14:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 9.14:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 4.66:1 | 3:1 | ✅ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 4.62:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 3.48:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 3.33:1 | 3:1 | ✅ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 4.49:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.16:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.35:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.16:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.35:1 | n/a | · |

### operations — dark

29 measured pairings, 0 failing, 3 warning. Tightest sits at 46% of the ratio it wants.

| Token | oklch | sRGB |
| --- | --- | --- |
| `--background` | `oklch(18% 0.04 246deg)` | `#021322` |
| `--foreground` | `oklch(94.5% 0.011 246deg)` | `#e7eef4` |
| `--primary` | `oklch(66% 0.145 266deg)` | `#688eeb` |
| `--accent` | `oklch(29% 0.05 246deg)` | `#142d43` |
| `--input` | `oklch(52.5% 0.048 246deg)` | `#546d85` |
| `--border` | `oklch(32.5% 0.048 246deg)` | `#1e364b` |

| Pairing | Foreground | Background | Kind | Ratio | Wants | |
| --- | --- | --- | --- | --: | --: | :-: |
| body text on page | `--foreground` | `--background` | body text | 16.03:1 | 4.5:1 | ✅ |
| body text on card | `--card-foreground` | `--card` | body text | 14.63:1 | 4.5:1 | ✅ |
| body text on popover | `--popover-foreground` | `--popover` | body text | 14.63:1 | 4.5:1 | ✅ |
| body text on secondary | `--secondary-foreground` | `--secondary` | body text | 13.22:1 | 4.5:1 | ✅ |
| body text on muted | `--foreground` | `--muted` | body text | 13.22:1 | 4.5:1 | ✅ |
| body text on accent | `--accent-foreground` | `--accent` | body text | 12.07:1 | 4.5:1 | ✅ |
| muted text on page | `--muted-foreground` | `--background` | body text | 6.19:1 | 4.5:1 | ✅ |
| muted text on card | `--muted-foreground` | `--card` | body text | 5.65:1 | 4.5:1 | ✅ |
| muted text on muted surface | `--muted-foreground` | `--muted` | body text | 5.11:1 | 4.5:1 | ✅ |
| button label on primary | `--primary-foreground` | `--primary` | body text | 5.90:1 | 4.5:1 | ✅ |
| link text on page | `--primary` | `--background` | body text | 5.95:1 | 4.5:1 | ✅ |
| link text on card | `--primary` | `--card` | body text | 5.43:1 | 4.5:1 | ✅ |
| destructive text on tint (page) | `--destructive` | `--destructive/10 over --background` | body text | 6.34:1 | 4.5:1 | ✅ |
| destructive text on tint (card) | `--destructive` | `--destructive/10 over --card` | body text | 5.71:1 | 4.5:1 | ✅ |
| sidebar text | `--sidebar-foreground` | `--sidebar` | body text | 14.63:1 | 4.5:1 | ✅ |
| sidebar active item | `--sidebar-primary-foreground` | `--sidebar-primary` | body text | 5.90:1 | 4.5:1 | ✅ |
| sidebar hovered item | `--sidebar-accent-foreground` | `--sidebar-accent` | body text | 12.07:1 | 4.5:1 | ✅ |
| input border on page | `--input` | `--background` | UI / graphical | 3.49:1 | 3:1 | ✅ |
| input border on card | `--input` | `--card` | UI / graphical | 3.18:1 | 3:1 | ⚠️ |
| focus ring on page | `--ring` | `--background` | UI / graphical | 5.95:1 | 3:1 | ✅ |
| focus ring on card | `--ring` | `--card` | UI / graphical | 5.43:1 | 3:1 | ✅ |
| sidebar focus ring | `--sidebar-ring` | `--sidebar` | UI / graphical | 5.43:1 | 3:1 | ✅ |
| chart 1 on card | `--chart-1` | `--card` | UI / graphical | 8.92:1 | 3:1 | ✅ |
| chart 2 on card | `--chart-2` | `--card` | UI / graphical | 3.71:1 | 3:1 | ✅ |
| chart 3 on card | `--chart-3` | `--card` | UI / graphical | 4.93:1 | 3:1 | ✅ |
| chart 4 on card | `--chart-4` | `--card` | UI / graphical | 5.15:1 | 3:1 | ✅ |
| chart 5 on card | `--chart-5` | `--card` | UI / graphical | 3.81:1 | 3:1 | ✅ |
| divider on page | `--border` | `--background` | advisory | 1.51:1 | 3:1 | ⚠️ |
| divider on card | `--border` | `--card` | advisory | 1.37:1 | 3:1 | ⚠️ |
| card edge against page | `--card` | `--background` | decorative | 1.10:1 | n/a | · |
| sidebar divider | `--sidebar-border` | `--sidebar` | decorative | 1.37:1 | n/a | · |
