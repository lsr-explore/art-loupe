/**
 * The enumerated values `ProjectIntent` is built from, with no Zod behind them.
 *
 * Split out of `intent.ts` for one reason, and it is measured rather than stylistic: a browser
 * form needs these lists to render its options, `intent.ts` imports `zod` at module scope, and
 * the package's barrel re-exports everything — so importing `MEDIA` from `@artloupe/schemas`
 * puts the whole of Zod in the client bundle. It did: the studio's chunk total went from
 * 248 kB to 347 kB gzipped on the first import, against a 300 kB budget.
 *
 * So the *values* live here, zod-free and reachable at `@artloupe/schemas/intent-values`, and
 * the *schema* that validates against them stays in `intent.ts`. Both are still re-exported
 * from the barrel, so nothing on the server side changes; what changes is that a client can
 * reach the lists without reaching the validator.
 *
 * The mirror in `python/libs/schemas` is not split — there is no bundle on that side, and
 * splitting it would make the two files harder to compare, which is the property the parity
 * fixture depends on.
 */

/**
 * The media a plan can be built for.
 *
 * Scoped deliberately: pastel, gouache, and digital are **not** supported in the first
 * version, so they are absent rather than accepted-and-handled-badly. Every entry here is a
 * medium the planner is expected to produce a defensible plan for.
 *
 * Spelling follows the repo's existing convention — `watercolour`, `coloured-pencil`, to
 * match `licence` and "eight-colour palette" in the design documents. These are wire values,
 * so a mixed convention would be a lasting papercut.
 *
 * Kept as one editable array on each side: widening it is a two-line diff, and it is the
 * kind of call that belongs to whoever owns the art domain.
 */
export const MEDIA = [
  'graphite',
  'charcoal',
  'ink',
  'coloured-pencil',
  'watercolour',
  'acrylic',
  'oil',
] as const;

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

export type Medium = (typeof MEDIA)[number];
export type SkillLevel = (typeof SKILL_LEVELS)[number];
