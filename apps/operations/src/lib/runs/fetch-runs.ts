import 'server-only';
import type { CostWindow } from '@artloupe/schemas/ops-cost';
import {
  type RunDetail,
  type RunHealthReport,
  runDetailSchema,
  runHealthReportSchema,
} from '@artloupe/schemas/ops-runs';

import { type OpsResult, readFromAgent } from '@/lib/ops-api';

export const fetchRunHealth = (costWindow: CostWindow): Promise<OpsResult<RunHealthReport>> =>
  readFromAgent(
    `/ops/runs?window=${costWindow}`,
    runHealthReportSchema,
    (report) => report.window === costWindow,
  );

/** One run's drill-down. The caller has already checked `runId` is a UUID. */
export const fetchRunDetail = (runId: string): Promise<OpsResult<RunDetail>> =>
  readFromAgent(
    `/ops/runs/${encodeURIComponent(runId)}`,
    runDetailSchema,
    (detail) => detail.run.run_id === runId,
  );
