import type { PolicySettings } from '@revenue-os/shared';

const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const STEP_MS = 15 * 60_000;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local weekday (0 = Sunday), hour, minute and date in `tz`. */
export function localParts(d: Date, tz: string): { day: number; hour: number; minute: number; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { day: DAYS[parts.weekday!]!, hour: Number(parts.hour), minute: Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

export function inSendWindow(d: Date, tz: string, w: PolicySettings['sendWindow']): boolean {
  const p = localParts(d, tz);
  return w.days.includes(p.day) && p.hour >= w.startHour && p.hour < w.endHour;
}

/** Next quarter-hour step strictly after `d`. Quarter hours line up with every real-world UTC offset. */
function nextStep(d: Date): Date {
  return new Date(Math.floor(d.getTime() / STEP_MS) * STEP_MS + STEP_MS);
}

/** The first moment at or after `d` inside the window (within 8 days), or null when the window never opens. */
export function nextWindowStart(d: Date, tz: string, w: PolicySettings['sendWindow']): Date | null {
  if (inSendWindow(d, tz, w)) return d;
  let t = nextStep(d);
  for (let i = 0; i < 8 * 96; i++, t = new Date(t.getTime() + STEP_MS)) if (inSendWindow(t, tz, w)) return t;
  return null;
}

/** The next local midnight after `d`. */
export function nextLocalMidnight(d: Date, tz: string): Date {
  const today = localParts(d, tz).date;
  let t = nextStep(d);
  for (let i = 0; i < 2 * 96; i++, t = new Date(t.getTime() + STEP_MS)) if (localParts(t, tz).date !== today) return t;
  return new Date(d.getTime() + 24 * 3_600_000);
}

/** The start of the local day containing `d` (approximate across a DST change, which only shifts it by an hour). */
export function startOfLocalDay(d: Date, tz: string): Date {
  const p = localParts(d, tz);
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000 - (p.hour * 60 + p.minute) * 60_000);
}
