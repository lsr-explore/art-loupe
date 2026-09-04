/**
 * The TypeScript half of the hand-authored mirror's safety net.
 *
 * `python/libs/schemas/tests/test_parity.py` loads the same fixture and asserts the same
 * things. A field added on one side and forgotten on the other fails here — in the suite
 * that did not change, which is the only place a drift is cheap to notice.
 */

import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import rawFixture from '../fixtures/contract-parity.json';
import { artifactMetadataSchema } from './artifact';
import { budgetLedgerSchema } from './budget';
import { claimSchema } from './evidence';
import { imageRefSchema } from './image';
import { projectIntentSchema } from './intent';
import { toolManifestSchema } from './manifest';

interface ParityFixture {
  accepts: {
    claims: { evidence: { kind: string } }[];
    image_refs: unknown[];
    project_intents: Record<string, { input: unknown; expected: unknown }>;
    tool_manifests: unknown[];
    artifact_metadata: { tool: string }[];
    budget_ledgers: { stopped: boolean }[];
  };
  rejects: Record<string, { schema: string; value: unknown }>;
}

/**
 * Drop the `$comment` annotations the fixture carries for human readers.
 *
 * Stripping them explicitly rather than relying on both libraries ignoring unknown keys:
 * "Zod and Pydantic happen to treat extras the same way" is itself a drift risk, and not
 * one this suite should be silently depending on.
 */
const stripComments = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripComments);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '$comment')
        .map(([key, entry]) => [key, stripComments(entry)]),
    );
  }
  return value;
};

const fixture = stripComments(rawFixture) as ParityFixture;
const { accepts, rejects } = fixture;

const SCHEMAS: Record<string, ZodType> = {
  claim: claimSchema,
  image_ref: imageRefSchema,
  project_intent: projectIntentSchema,
  tool_manifest: toolManifestSchema,
  artifact_metadata: artifactMetadataSchema,
  budget_ledger: budgetLedgerSchema,
};

// @trace flow=platform.contracts category=data
describe('contract parity fixture — accepted values', () => {
  for (const claim of accepts.claims) {
    it(`parses a ${claim.evidence.kind} claim`, () => {
      expect(() => claimSchema.parse(claim)).not.toThrow();
    });
  }

  it('covers every evidence class the taxonomy defines', () => {
    const kinds = accepts.claims.map((claim) => claim.evidence.kind);
    expect(new Set(kinds)).toEqual(new Set(['measured', 'cited', 'chosen']));
  });

  accepts.image_refs.forEach((image, index) => {
    it(`parses image ref ${index}`, () => {
      expect(() => imageRefSchema.parse(image)).not.toThrow();
    });
  });

  for (const [name, entry] of Object.entries(accepts.project_intents)) {
    it(`parses the ${name} project intent and fills the documented defaults`, () => {
      expect(projectIntentSchema.parse(entry.input)).toEqual(entry.expected);
    });
  }

  accepts.tool_manifests.forEach((manifest, index) => {
    it(`parses tool manifest ${index}`, () => {
      expect(() => toolManifestSchema.parse(manifest)).not.toThrow();
    });
  });

  for (const metadata of accepts.artifact_metadata) {
    it(`parses ${metadata.tool} artifact metadata`, () => {
      expect(() => artifactMetadataSchema.parse(metadata)).not.toThrow();
    });
  }

  it('keeps a null confidence distinct from a zero one', () => {
    const grayscale = accepts.artifact_metadata.find((metadata) => metadata.tool === 'grayscale');
    expect(artifactMetadataSchema.parse(grayscale).confidence).toBeNull();
  });

  for (const ledger of accepts.budget_ledgers) {
    it(`parses a ledger with stopped=${ledger.stopped}`, () => {
      expect(() => budgetLedgerSchema.parse(ledger)).not.toThrow();
    });
  }
});

// @trace flow=platform.contracts category=data
describe('contract parity fixture — rejected values', () => {
  for (const [name, entry] of Object.entries(rejects)) {
    it(`rejects ${name}`, () => {
      const schema = SCHEMAS[entry.schema];
      expect(schema, `fixture names an unknown schema: ${entry.schema}`).toBeDefined();
      expect(() => schema.parse(entry.value)).toThrow();
    });
  }

  it('names only schemas this suite knows how to validate', () => {
    const named = new Set(Object.values(rejects).map((entry) => entry.schema));
    for (const name of named) {
      expect(Object.keys(SCHEMAS)).toContain(name);
    }
  });
});
