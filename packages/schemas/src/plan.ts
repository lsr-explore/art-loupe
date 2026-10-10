/**
 * What the Visual Analyst, the lesson source, the Studio Planner and the Plan Critic hand on
 * (`python/libs/schemas/.../plan.py`).
 *
 * Every claim a plan makes is a `PlanClaim`: the evidence taxonomy's `Claim`, plus the id of the
 * upstream finding or lesson it was carried forward from. A measured claim names its
 * `finding_id`, a cited one names its `lesson_id`, and a chosen one has no source. The agent
 * service copies the evidence across from that finding or lesson, so a model never authors a
 * tool name, a checksum or a URL.
 *
 * Plan-level agreement — materials against stages, time boxes against the budget — is the Plan
 * Critic's job, reported as typed defects (FR-702). The schema refuses only what no producer may
 * emit.
 *
 * Every object is strict, mirroring Pydantic's `extra="forbid"`, because these are nested inside
 * the strict `runResultSchema`. The `evidence` inside each claim is the shared `evidenceSchema`,
 * which is not strict yet (#68).
 */

import { z } from 'zod';

import { citedSchema, evidenceSchema, measuredSchema } from './evidence';

/** The id an agent cites a finding, lesson, stage or material by. */
export const referenceIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_-]*$/, 'a reference id is lowercase letters, digits, - and _');

const hasDuplicates = (ids: string[]) => new Set(ids).size !== ids.length;

export const findingSchema = z.strictObject({
  finding_id: referenceIdSchema,
  text: z.string().min(1),
  evidence: measuredSchema,
});

export const setAsideSchema = z.strictObject({
  finding_id: referenceIdSchema,
  reason: z.string().min(1),
});

export const visualFindingsSchema = z
  .strictObject({
    findings: z.array(findingSchema),
    set_aside: z.array(setAsideSchema),
  })
  .refine(
    (value) =>
      !hasDuplicates([...value.findings, ...value.set_aside].map((entry) => entry.finding_id)),
    'a finding is either used or set aside, and named once',
  );

export const LESSON_TOPICS = ['technique', 'materials'] as const;

export const citedLessonSchema = z.strictObject({
  lesson_id: referenceIdSchema,
  topic: z.enum(LESSON_TOPICS),
  title: z.string().min(1),
  text: z.string().min(1),
  evidence: citedSchema,
});

export const planClaimSchema = z
  .strictObject({
    text: z.string().min(1),
    evidence: evidenceSchema,
    /** A `finding_id` for a measured claim, a `lesson_id` for a cited one, `null` for a chosen one. */
    source: referenceIdSchema.nullable(),
  })
  .refine(
    (claim) => (claim.evidence.kind === 'chosen') === (claim.source === null),
    'a chosen claim has no source, and a measured or cited claim must name one',
  );

export const MATERIAL_CATEGORIES = ['surface', 'drawing', 'paint', 'brush', 'tool'] as const;

export const materialItemSchema = z.strictObject({
  item_id: referenceIdSchema,
  category: z.enum(MATERIAL_CATEGORIES),
  /** A class of thing, never a product: "hot-press watercolour paper, 300 gsm". */
  specification: z.string().min(1),
  claim: planClaimSchema,
});

export const planStageSchema = z.strictObject({
  stage_id: referenceIdSchema,
  title: z.string().min(1),
  minutes: z.int().positive(),
  goal: z.string().min(1),
  /** How the artist knows the stage is done. Something they check by eye, never the system. */
  completion_signal: z.string().min(1),
  /** The `item_id`s this stage uses. The Plan Critic checks them against the list (FR-608). */
  materials: z.array(referenceIdSchema),
  /** What the stage rests on (FR-602). Empty is a `missing_evidence` defect, not an error. */
  claims: z.array(planClaimSchema),
});

export const SUITABILITIES = ['good_fit', 'workable', 'poor_fit'] as const;

export const referenceAssessmentSchema = z.strictObject({
  suitability: z.enum(SUITABILITIES),
  claims: z.array(planClaimSchema),
});

export const projectPlanSchema = z
  .strictObject({
    assessment: referenceAssessmentSchema,
    materials: z.array(materialItemSchema),
    stages: z.array(planStageSchema).min(1),
    /** FR-605's self-check card: questions the artist asks of their own work. */
    self_check: z.array(z.string()).min(1),
  })
  .refine(
    (plan) => !hasDuplicates(plan.stages.map((stage) => stage.stage_id)),
    'every stage needs its own stage_id',
  )
  .refine(
    (plan) => !hasDuplicates(plan.materials.map((item) => item.item_id)),
    'every material needs its own item_id',
  );

/** FR-702's closed set. Widening it is a contract change on both sides. */
export const DEFECT_CATEGORIES = [
  'unsupported_measurement',
  'missing_evidence',
  'irrelevant_medium_advice',
  'infeasible_timebox',
  'unclassified_claim',
  'materials_mismatch',
  'policy_violation',
] as const;

export const planDefectSchema = z.strictObject({
  category: z.enum(DEFECT_CATEGORIES),
  detail: z.string().min(1),
  /** The `stage_id` or `item_id` the defect is about, or `null` for the plan as a whole. */
  location: z.string().nullable().default(null),
  /** `check` is the service's deterministic arithmetic; `critic` is the model's judgement. */
  origin: z.enum(['check', 'critic']),
});

export const VERDICTS = ['READY', 'READY_WITH_CAUTION', 'REVISE'] as const;

export const criticVerdictSchema = z
  .strictObject({
    verdict: z.enum(VERDICTS),
    defects: z.array(planDefectSchema),
    summary: z.string().min(1),
    /** Which plan version this judged: 0 is the first plan, 1 the revision (FR-704 allows one). */
    revision: z.int().min(0).max(1),
  })
  .refine(
    (value) => value.verdict !== 'READY' || value.defects.length === 0,
    'a plan with open defects is not READY',
  )
  .refine(
    (value) => value.verdict !== 'REVISE' || value.revision === 0,
    'the revision is the last one; an unresolved plan ships with caution',
  );

export const planOutcomeSchema = z.strictObject({
  findings: visualFindingsSchema,
  lessons: z.array(citedLessonSchema),
  plan: projectPlanSchema,
  /** One verdict per plan version, oldest first. The last one is the plan's standing (FR-705). */
  verdicts: z.array(criticVerdictSchema).min(1).max(2),
});

export type Finding = z.infer<typeof findingSchema>;
export type SetAside = z.infer<typeof setAsideSchema>;
export type VisualFindings = z.infer<typeof visualFindingsSchema>;
export type LessonTopic = (typeof LESSON_TOPICS)[number];
export type CitedLesson = z.infer<typeof citedLessonSchema>;
export type PlanClaim = z.infer<typeof planClaimSchema>;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];
export type MaterialItem = z.infer<typeof materialItemSchema>;
export type PlanStage = z.infer<typeof planStageSchema>;
export type Suitability = (typeof SUITABILITIES)[number];
export type ReferenceAssessment = z.infer<typeof referenceAssessmentSchema>;
export type ProjectPlan = z.infer<typeof projectPlanSchema>;
export type DefectCategory = (typeof DEFECT_CATEGORIES)[number];
export type PlanDefect = z.infer<typeof planDefectSchema>;
export type Verdict = (typeof VERDICTS)[number];
export type CriticVerdict = z.infer<typeof criticVerdictSchema>;
export type PlanOutcome = z.infer<typeof planOutcomeSchema>;
