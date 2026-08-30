/**
 * Translation stubs for the entry point's tests.
 *
 * Extracted per `.claude/rules/testing.md` ("mock data in separate files"). The
 * other apps' page tests still inline their equivalents, but theirs are two or
 * three keys; this is the full panel and gate copy, and a launch-panels or
 * consent-checkbox test would want exactly the same set — which is the
 * duplication the rule exists to prevent.
 *
 * Keys are flat and namespace-relative because the component reads them through
 * `useTranslations('entry')`, so the mock is indexed the same way the real
 * catalogue is addressed at the call site.
 */
export const entryMessages: Record<string, string> = {
  title: 'Two surfaces, one studio',
  description: 'An artist studio and an operations view of the agents behind it.',
  'gate.error': 'Please acknowledge the synthetic-data notice before launching an app.',
  'panels.studio.title': 'Artist Studio',
  'panels.studio.description': 'Critique, palettes, and session planning for your work.',
  'panels.studio.cta': 'Launch App',
  'panels.operations.title': 'Operations Control',
  'panels.operations.description': 'Model cost and latency, retrieval-corpus health.',
  'panels.operations.cta': 'Go to Login',
  'panels.operations.badge': 'Authorized access only',
};

/** The rich-text chunk the gate label renders inside its About link. */
export const GATE_INFO_LINK_TEXT = 'How the data is generated';
