# Frontend rules

Apply when editing files in `apps/*/src/` or `packages/fascia/src/`.

- Use strict TypeScript.
- Prefer functional React components.
- Avoid `any` unless necessary and documented.
- Follow accessibility best practices that comply with WCAG 2.2 AA and ARIA guidelines.
- Use Tailwind utility classes consistently; design tokens live in `packages/fascia`.
- Avoid deeply nested components.
- Prefer semantic HTML.
- Import shared UI primitives from `@artloupe/fascia` — don't duplicate them per app.
- i18n strings live in `apps/*/messages/*.json` and are accessed via `next-intl`. Don't hard-code user-facing copy.
