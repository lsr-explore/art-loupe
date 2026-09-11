# Media assets — provenance & licensing

Third-party imagery committed to this repo. The same per-source verdict discipline the
retrieval corpus will use: nothing ships until its terms are read and the verdict is
written down here.

Verdict key: ✅ safe to commit and ship · ⚠️ conditions attached · ❌ do not commit.

| Asset | Source | Verdict | Terms honored |
| --- | --- | --- | --- |
| `apps/studio/public/portal-backdrop.jpg` | [Pexels](https://www.pexels.com/photo/serene-ocean-view-at-dusk-with-soft-waves-36457441/) — *Serene ocean view at dusk with soft waves*, Kostas Dimopoulos | ✅ Pexels License | Attribution optional, given anyway (below); no identifiable people in the frame; not resold, not redistributed as stock, not used as a mark |
| `fixtures/demo-images/pexels-dalia-nava-167975-7954434.jpg` | [Pexels](https://www.pexels.com/photo/view-of-gondolas-moored-on-the-sides-of-the-canal-in-murano-venice-italy-7954434/) — *View of Gondolas Moored on the Sides of the Canal in Murano, Venice, Italy*, dalia nava | ✅ Pexels License | Attribution given (below); unmodified original kept as a test and demo input, not redistributed as stock, not used as a mark |
| `fixtures/demo-images/pexels-tim-diercks-719708976-31589335.jpg` | [Pexels](https://www.pexels.com/photo/portrait-of-male-model-with-striped-sweater-31589335/) — *Studio portrait of a young male model in a striped sweater, Hamburg.*, Tim Diercks | ⚠️ Pexels License | An **identifiable person**: never shown unfavourably, and never identified or characterised (FR-802) — the sitter is a drawing reference, nothing more |

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

## `fixtures/demo-images/`

The two reference photographs the [e2e walkthrough](design/e2e-walkthrough.md) is built on —
run A (portrait) and run B (canal) — committed as unmodified originals so the demo, the
walkthrough, and tests all read the same bytes. Both carry an attribution in their EXIF
(`artist` / `copyright`); neither carries GPS or camera data.

| File | SHA-256 | Pixels |
| --- | --- | --- |
| `pexels-dalia-nava-167975-7954434.jpg` | `003fde582efcce54da2cf0793c0e594686506e8897de47efa44113cf5723ae8c` | 5040 × 3360 |
| `pexels-tim-diercks-719708976-31589335.jpg` | `8fe9582f197a30ad9ee4b3c7ee1bfff2a0af40ab6578d04482c391659ba22b72` | 4016 × 6016 |

- **Photographers:** dalia nava; Tim Diercks — both via Pexels.
- **License terms verified:** 2026-09-11 against <https://www.pexels.com/license/>, with the
  same terms recorded for `portal-backdrop.jpg` above. A public source repository is not a
  stock or wallpaper platform, so the redistribution prohibition is not engaged.
- **The portrait's condition.** The Pexels licence's only term about people is that they may
  not appear "in a bad light or in a way that is offensive". The product's own rule is
  stricter and applies here in full: FR-802 — no identity recognition, and no inference of
  sensitive traits from a face. Nothing in this repository names, describes, or characterises
  the sitter beyond quoting the photographer's own title as attribution.
- **Used by:** `python/libs/image-tools/tests/test_perspective_photographs.py` (canal and
  portrait), and the walkthrough's live demo uploads.
