import 'server-only';
import { type CostReport, type CostWindow, costReportSchema } from '@artloupe/schemas/ops-cost';

import { type OpsResult, readFromAgent } from '@/lib/ops-api';

export type CostReportResult = OpsResult<CostReport>;

/** The cost report for one window. A report for another window would mislabel its spend. */
export const fetchCostReport = (costWindow: CostWindow): Promise<CostReportResult> =>
  readFromAgent(
    `/ops/costs?window=${costWindow}`,
    costReportSchema,
    (report) => report.window === costWindow,
  );
