/**
 * Shared TS contracts for Art Loupe.
 *
 * Zod schemas and inferred types for the boundary between the apps and the Python agent
 * layer, mirroring `python/libs/schemas` field for field. `.parse()` at the seam is the
 * anti-confabulation guarantee: never render a decision that has not been validated.
 *
 * The mirror is hand-authored and kept honest by `fixtures/contract-parity.json`, which
 * both this package's suite and the Python suite validate. Codegen from the Pydantic
 * models, with committed output and a CI drift check, remains the planned follow-up.
 */

export { type ArtifactMetadata, artifactMetadataSchema } from './artifact';
export { type BudgetLedger, budgetLedgerSchema } from './budget';
export {
  type Chosen,
  type Cited,
  type Claim,
  checksumSchema,
  chosenSchema,
  citedSchema,
  claimSchema,
  type Evidence,
  evidenceSchema,
  MEASUREMENT_UNITS,
  type Measured,
  type MeasurementUnit,
  measuredSchema,
} from './evidence';
export {
  ACCEPTED_MIME_TYPES,
  type AcceptedMimeType,
  type ImageRef,
  imageRefSchema,
  MAX_UPLOAD_BYTES,
  MIN_LONG_EDGE_PX,
} from './image';
export {
  MEDIA,
  type Medium,
  type ProjectIntent,
  projectIntentSchema,
  SKILL_LEVELS,
  type SkillLevel,
  type SupportSize,
  supportSizeSchema,
} from './intent';
export {
  TOOLS,
  type ToolDeclination,
  type ToolManifest,
  type ToolName,
  type ToolSelection,
  toolDeclinationSchema,
  toolManifestSchema,
  toolSelectionSchema,
} from './manifest';
