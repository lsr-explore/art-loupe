/**
 * Vite's `?raw` suffix, used by `brand-logo.test.tsx` to read the two variant
 * SVGs as strings. Declared here because this package has no `@types/node`, so the
 * alternative — `fs.readFileSync` plus `process.cwd()` — doesn't typecheck.
 */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}
