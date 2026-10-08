import { useTranslations } from 'next-intl';

import type { OpsFailure } from '@/lib/ops-api';

const KEYS: Record<OpsFailure, string> = {
  'signed-out': 'signedOut',
  forbidden: 'forbidden',
  'not-found': 'notFound',
  unavailable: 'unavailable',
};

/** Why a panel has no data. Rendered once on the server, so it is plain text, not a live region. */
export const OpsStateMessage = ({ status }: { status: OpsFailure }) => {
  const to = useTranslations('opsState');
  return <p className="rounded-md border p-4 text-sm">{to(KEYS[status])}</p>;
};
