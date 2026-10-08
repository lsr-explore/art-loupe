import { z } from 'zod/v4';

const medium = z.enum([
  'graphite',
  'charcoal',
  'ink',
  'coloured-pencil',
  'watercolour',
  'acrylic',
  'oil',
]);
export const learningRequestSchema = z.strictObject({
  question: z.string().trim().min(3).max(2000),
  locale: z.enum(['en', 'es']).default('en'),
  medium: medium.nullable().default(null),
  history: z
    .array(
      z.strictObject({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(6)
    .default([]),
});
export const learningResponseSchema = z
  .strictObject({
    status: z.enum(['answered', 'insufficient_evidence']),
    claims: z
      .array(
        z.strictObject({
          text: z.string().trim().min(1).max(1500),
          citation_ids: z.array(z.string().trim()).min(1).max(4),
        }),
      )
      .max(8),
    practice: z.string().trim().max(1500).nullable().default(null),
    gap: z.string().trim().max(800).nullable().default(null),
    sources: z
      .array(
        z.strictObject({
          id: z.string().trim(),
          title: z.string().trim(),
          author: z.string().trim(),
          locator: z.string().trim(),
          url: z
            .string()
            .trim()
            .pipe(z.url())
            .refine((value) => {
              try {
                const url = new URL(value);
                return url.protocol === 'https:' && !url.username && !url.password;
              } catch {
                return false;
              }
            }),
          license: z.string().trim(),
          historical: z.boolean(),
          excerpt: z.string().trim().min(1).max(12000),
        }),
      )
      .max(12)
      .default([]),
    retrieval_mode: z.enum(['keyword', 'hybrid']),
    corpus_version: z.string().trim().min(1),
    usage: z
      .strictObject({
        input_tokens: z.number().int().nonnegative().default(0),
        output_tokens: z.number().int().nonnegative().default(0),
        embedding_tokens: z.number().int().nonnegative().default(0),
      })
      .default({ input_tokens: 0, output_tokens: 0, embedding_tokens: 0 }),
  })
  .superRefine((answer, context) => {
    const available = new Set(answer.sources.map((source) => source.id));
    const used = new Set(answer.claims.flatMap((claim) => claim.citation_ids));
    if (
      available.size !== answer.sources.length ||
      [...used].some((id) => !available.has(id)) ||
      [...available].some((id) => !used.has(id))
    )
      context.addIssue({ code: 'custom', message: 'Invalid citation mapping' });
    if (answer.status === 'answered' && !answer.claims.length)
      context.addIssue({ code: 'custom', message: 'An answer requires evidence' });
    if (
      answer.status === 'insufficient_evidence' &&
      (answer.claims.length || answer.sources.length || answer.practice || !answer.gap)
    )
      context.addIssue({ code: 'custom', message: 'An evidence gap cannot carry an answer' });
  });
export type LearningRequest = z.infer<typeof learningRequestSchema>;
export type LearningAnswer = z.infer<typeof learningResponseSchema>;
