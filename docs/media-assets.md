# Media assets — provenance & licensing

Third-party imagery committed to this repo. The same per-source verdict discipline the
retrieval corpus will use: nothing ships until its terms are read and the verdict is
written down here.

Verdict key: ✅ safe to commit and ship · ⚠️ conditions attached · ❌ do not commit.

| Asset | Source | Verdict | Terms honored |
| --- | --- | --- | --- |
| `apps/studio/public/portal-backdrop.jpg` | [Pexels](https://www.pexels.com/photo/serene-ocean-view-at-dusk-with-soft-waves-36457441/) — *Serene ocean view at dusk with soft waves*, Kostas Dimopoulos | ✅ Pexels License | Attribution optional, given anyway (below); no identifiable people in the frame; not resold, not redistributed as stock, not used as a mark |

## `portal-backdrop.jpg`

- **Photographer:** Kostas Dimopoulos, via Pexels
- **Source URL:** <https://www.pexels.com/photo/serene-ocean-view-at-dusk-with-soft-waves-36457441/>
- **Original filename:** `pexels-kostas-dimopoulos-119583302-36457441.jpg`
- **License terms verified:** 2026-08-01 against <https://www.pexels.com/license/>.
  Free to use, commercial use allowed, **attribution not required**, modification allowed.
  Prohibited: showing identifiable people unfavourably · selling unaltered copies ·
  implying endorsement · redistributing on other stock platforms · use as a trade or
  service mark. The asset is a seascape with no people, ships as a decorative page
  backdrop, and is not resold — none of the prohibitions are engaged.
- **Attribution:** not required by the license; will eventually be added in the About site's
  Credits section. This file is the repo-side provenance
  record, not a substitute for that user-facing credit.

### Where it renders

The login screen today — see `apps/studio/src/components/auth/login-backdrop.tsx`, which
paints it at `opacity-75`. The signed-in portal surface that will also carry it is not
built yet. **Body text never composites over
the photograph**, which is a structural rule rather than a tuned opacity: measured against
the darkest composited pixel, `--muted-foreground` reads 1.13:1 at the settled 0.75 opacity
and only reaches 3.85:1 even at 0.15, so no opacity value in either theme satisfies WCAG
1.4.3. The panel carries `bg-background` and every descendant keeps the contrast the
[contrast gate](contrast-report/contrast.md) already verifies for it.
