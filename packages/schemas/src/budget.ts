/**
 * The per-project plan budget (NFR-04): a token ceiling with a hard stop, visible in
 * operations.
 *
 * `agents.md` §3 sketches this as "tokens, image calls, cache hits, hard stop". The middle
 * term is recorded here as `tool_calls`, meaning invocations of the deterministic image
 * tools — with no provider image endpoint reachable from any node (FR-801), there are no
 * image *generation* calls left to meter.
 *
 * Two ledgers exist in the finished design and neither can stop the other: this one covers
 * plan generation, and chat credits are separate (NFR-11). Only this one is in slice 1.
 *
 * One resume hazard worth knowing before anything increments a counter here: on resume,
 * LangGraph re-runs the *whole node* containing `interrupt()` from the top. Any metering
 * that happens before the interrupt call is therefore charged twice. Keep `interrupt()`
 * alone in a node that does nothing else.
 */

import { z } from 'zod';

export const budgetLedgerSchema = z
  .object({
    input_tokens: z.int().nonnegative().default(0),
    output_tokens: z.int().nonnegative().default(0),
    /** Deterministic image-tool invocations, not provider image generation (FR-801). */
    tool_calls: z.int().nonnegative().default(0),
    cache_hits: z.int().nonnegative().default(0),
    token_ceiling: z.int().positive(),
    stopped: z.boolean().default(false),
    /** Required whenever `stopped` — a hard stop with no reason is unreviewable. */
    stop_reason: z.string().min(1).nullable().default(null),
  })
  .refine(
    (ledger) => !ledger.stopped || ledger.stop_reason !== null,
    'a stopped ledger must carry a stop_reason',
  );

export type BudgetLedger = z.infer<typeof budgetLedgerSchema>;
