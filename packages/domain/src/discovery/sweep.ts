import type { PrismaClient } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { ENGINE_STATES, systemContext } from './engine.js';

/** A mission in an engine phase that nobody has touched for this long (and whose lease ran out) is presumed orphaned. */
export const STALE_MISSION_MS = 2 * 60_000;
const SWEEP_LIMIT = 200;

export interface SweepJob {
  workspaceId: string;
  missionId: string;
  /** Stable per mission and minute, so overlapping sweeps don't queue the same advance twice. */
  jobId: string;
}

/**
 * Crash recovery + retry timer for discovery (docs/11 §55, contract "sweepDiscoveryMissions"): missions whose worker
 * died mid-round (lease expired, no progress for 2 minutes) and WAITING missions whose retry time has come get an
 * advance job. WAITING ones are moved back to the phase they were in first (guarded, with an event). Idempotent.
 */
export async function sweepDiscoveryMissions(db: PrismaClient, enqueue: (job: SweepJob) => Promise<void>, now: Date = new Date()): Promise<{ orphaned: number; woken: number }> {
  const bucket = Math.floor(now.getTime() / 60_000);
  const job = (m: { id: string; workspaceId: string }): SweepJob => ({ workspaceId: m.workspaceId, missionId: m.id, jobId: `sweep.${m.id}.${bucket}` });

  const orphaned = await db.discoveryMission.findMany({
    where: {
      status: { in: ENGINE_STATES },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      updatedAt: { lt: new Date(now.getTime() - STALE_MISSION_MS) },
    },
    select: { id: true, workspaceId: true },
    orderBy: { updatedAt: 'asc' },
    take: SWEEP_LIMIT,
  });
  for (const m of orphaned) await enqueue(job(m));

  const waiting = await db.discoveryMission.findMany({
    where: { status: 'WAITING', retryAt: { lte: now } },
    select: { id: true, workspaceId: true, resumeStatus: true },
    orderBy: { retryAt: 'asc' },
    take: SWEEP_LIMIT,
  });
  let woken = 0;
  for (const m of waiting) {
    const status = m.resumeStatus && ENGINE_STATES.includes(m.resumeStatus) ? m.resumeStatus : 'PLANNING';
    const moved = await db.$transaction(async (tx) => {
      const { count } = await tx.discoveryMission.updateMany({
        where: { id: m.id, status: 'WAITING', retryAt: { lte: now } },
        data: { status, resumeStatus: null, retryAt: null, statusReason: null, version: { increment: 1 } },
      });
      if (count) await recordEvent(tx, systemContext(m.workspaceId), 'DiscoveryMissionResumed', m.id, { missionId: m.id, status });
      return count > 0;
    });
    if (!moved) continue;
    woken++;
    await enqueue(job(m));
  }
  return { orphaned: orphaned.length, woken };
}
