'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACK_COOKIE_NAME, ACK_COOKIE_VALUE, ackCookieOptions } from '@/lib/ack-cookie';
import { appOrigins, resolveNextUrl } from '@/lib/app-origins';
import { LAUNCH_TARGETS, type LaunchTarget } from '@/lib/launch-targets';

const isLaunchTarget = (value: unknown): value is LaunchTarget =>
  typeof value === 'string' && LAUNCH_TARGETS.includes(value as LaunchTarget);

/**
 * Records the acknowledgement and launches the chosen surface.
 *
 * The gate is enforced here as well as in the client component that renders it.
 * The client half owns the *experience* — error banner, focus move, `aria-invalid`
 * — but a server action is a public endpoint, so a form posted
 * without the checkbox must not set the cookie. Returning silently rather than
 * throwing keeps that path quiet: the only way to reach it is by hand.
 *
 * A deep link that bounced here carries `?next=`, and ticking the box resumes it
 * rather than dead-ending at the panel grid. It only wins when it points at the
 * surface that was actually clicked, though: an unacknowledged visitor bounced off
 * operations arrives carrying `next=<operations>`, and honouring that unconditionally
 * sent them to Operations Control even when they deliberately clicked Artist Studio.
 * A click is a fresher and more explicit signal than a parameter the user never typed,
 * so on disagreement the panel wins and the stale `next` is dropped.
 *
 * Anything failing the origin allowlist falls back to the panel's own origin.
 */
export const acknowledgeAndLaunch = async (formData: FormData): Promise<void> => {
  const acknowledged = formData.get('acknowledged') === 'on';
  const target = formData.get('target');

  if (!acknowledged || !isLaunchTarget(target)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACK_COOKIE_NAME, ACK_COOKIE_VALUE, ackCookieOptions());

  const targetOrigin = appOrigins()[target];
  const resumeTo = resolveNextUrl(formData.get('next')?.toString());

  // `resolveNextUrl` has already parsed this and checked it against the allowlist, so
  // the origin comparison here is about *which* surface, not about safety.
  const resumesToClickedTarget = resumeTo !== null && new URL(resumeTo).origin === targetOrigin;

  // `redirect` throws to unwind — it must sit outside any try/catch above it.
  redirect(resumesToClickedTarget ? resumeTo : targetOrigin);
};
