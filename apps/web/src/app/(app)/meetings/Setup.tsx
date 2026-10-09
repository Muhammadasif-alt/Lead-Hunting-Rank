"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Loader, Save } from "lucide-react";
import { MEETING_QUALIFICATION_INFO, MEETING_QUALIFICATION_RULES, WEEKDAYS, type MeetingQualificationRuleKey } from "@revenue-os/shared";
import { api, errorMessage, patch } from "@/lib/api";
import { minuteToTime, timeToMinute, type MeetingSetup, type MeetingTypeRow, type Profile } from "@/lib/meetings";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Vancouver", "Europe/London", "Europe/Berlin", "Asia/Karachi", "Asia/Kolkata", "Asia/Dubai", "Australia/Sydney", "UTC"];

/**
 * Meetings setup (screen #8 §2, §5): when I can be booked (working days, meeting hours, lunch, buffer, daily cap,
 * notice, which calendar, away), and the meeting types — what each needs from the deal and whether the AI may book it.
 */
export function Setup({ canManageTypes, canBook, onBack }: { canManageTypes: boolean; canBook: boolean; onBack: () => void }) {
  const [data, setData] = useState<MeetingSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<MeetingSetup>("/meetings/setup"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data)
    return error ? (
      <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    ) : (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading…
      </div>
    );

  return (
    <div className="space-y-5">
      <button type="button" className="btn btn-ghost -ml-2 text-sm" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back to meetings
      </button>
      {data.calendars.length === 0 && (
        <div className="card border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
          No calendar is connected, so no free times can be found.{" "}
          <Link href="/integrations" className="font-medium underline">
            Connect Google Calendar or the test calendar
          </Link>
          .
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {canBook ? <Availability data={data} onSaved={load} /> : <p className="card p-4 text-sm text-muted">You can’t be booked for meetings with your role.</p>}
        <Team data={data} />
      </div>
      <Types types={data.types} canManage={canManageTypes} onSaved={load} />
    </div>
  );
}

function Availability({ data, onSaved }: { data: MeetingSetup; onSaved: () => Promise<void> }) {
  const p = data.me;
  const [form, setForm] = useState({
    timezone: p?.timezone ?? data.suggestedTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    workingDays: p?.workingDays ?? [1, 2, 3, 4, 5],
    start: minuteToTime(p?.meetingStartMinute ?? 540),
    end: minuteToTime(p?.meetingEndMinute ?? 1020),
    lunch: p ? p.lunchStartMinute !== null : true,
    lunchStart: minuteToTime(p?.lunchStartMinute ?? 750),
    lunchEnd: minuteToTime(p?.lunchEndMinute ?? 810),
    buffer: p?.bufferMinutes ?? 15,
    maxPerDay: p?.maxMeetingsPerDay ?? 5,
    noticeHours: Math.round((p?.minNoticeMinutes ?? 240) / 60),
    calendarIntegrationId: p?.calendarIntegrationId ?? "",
    calendarId: p?.calendarId ?? "primary",
    accepts: p?.acceptsMeetings ?? true,
    awayUntil: p?.unavailableUntil ? p.unavailableUntil.slice(0, 10) : "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const zones = ZONES.includes(form.timezone) ? ZONES : [form.timezone, ...ZONES];

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api<Profile>("/meetings/availability/me", {
        method: "PUT",
        body: JSON.stringify({
          timezone: form.timezone,
          workingDays: form.workingDays,
          meetingStartMinute: timeToMinute(form.start),
          meetingEndMinute: timeToMinute(form.end),
          lunchStartMinute: form.lunch ? timeToMinute(form.lunchStart) : null,
          lunchEndMinute: form.lunch ? timeToMinute(form.lunchEnd) : null,
          bufferMinutes: form.buffer,
          maxMeetingsPerDay: form.maxPerDay,
          minNoticeMinutes: form.noticeHours * 60,
          calendarIntegrationId: form.calendarIntegrationId || null,
          calendarId: form.calendarId || "primary",
          acceptsMeetings: form.accepts,
          unavailableUntil: form.awayUntil ? new Date(`${form.awayUntil}T23:59:00`).toISOString() : null,
        }),
      });
      setMsg({ ok: true, text: "Saved — free times now follow these rules." });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold">When I can be booked</h2>
        <p className="text-sm text-muted">{p ? "Free times are found only inside these hours — and only where your calendar is free." : "Not set up yet — nobody can book you until you save this."}</p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-muted">Time zone</span>
        <select className="input" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted">Working days</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => {
            const on = form.workingDays.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set("workingDays", on ? form.workingDays.filter((x) => x !== i) : [...form.workingDays, i].sort())}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-tone bg-tone-soft text-tone" : "border-line text-muted"}`}
              >
                {d.slice(0, 3)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Meetings from</span>
          <input type="time" className="input" value={form.start} onChange={(e) => set("start", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">until</span>
          <input type="time" className="input" value={form.end} onChange={(e) => set("end", e.target.value)} />
        </label>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.lunch} onChange={(e) => set("lunch", e.target.checked)} /> Keep lunch free
        </label>
        {form.lunch && (
          <div className="grid grid-cols-2 gap-3">
            <input type="time" aria-label="Lunch from" className="input" value={form.lunchStart} onChange={(e) => set("lunchStart", e.target.value)} />
            <input type="time" aria-label="Lunch until" className="input" value={form.lunchEnd} onChange={(e) => set("lunchEnd", e.target.value)} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Buffer (min)</span>
          <input type="number" min={0} max={240} className="input" value={form.buffer} onChange={(e) => set("buffer", Number(e.target.value))} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Max per day</span>
          <input type="number" min={1} max={30} className="input" value={form.maxPerDay} onChange={(e) => set("maxPerDay", Number(e.target.value))} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Notice (hours)</span>
          <input type="number" min={0} max={336} className="input" value={form.noticeHours} onChange={(e) => set("noticeHours", Number(e.target.value))} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Calendar</span>
          <select className="input" value={form.calendarIntegrationId} onChange={(e) => set("calendarIntegrationId", e.target.value)}>
            <option value="">{data.calendars.length ? "The workspace’s connected calendar" : "None connected"}</option>
            {data.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.test ? " (test)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Calendar id</span>
          <input className="input" value={form.calendarId} onChange={(e) => set("calendarId", e.target.value)} placeholder="primary" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.accepts} onChange={(e) => set("accepts", e.target.checked)} /> Taking meetings
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Away until (leave empty if not)</span>
          <input type="date" className="input" value={form.awayUntil} onChange={(e) => set("awayUntil", e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || !form.workingDays.length} onClick={() => void save()}>
          {busy ? <Loader className="size-4 animate-spin" /> : <Save className="size-4" />} Save availability
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-brand" : "text-danger"}`}>{msg.text}</span>}
      </div>
    </section>
  );
}

function Team({ data }: { data: MeetingSetup }) {
  const summary = (p: Profile) => `${p.workingDays.map((d) => WEEKDAYS[d]!.slice(0, 2)).join(" ")} · ${minuteToTime(p.meetingStartMinute)}–${minuteToTime(p.meetingEndMinute)} ${p.timezone} · max ${p.maxMeetingsPerDay}/day`;
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="font-semibold">Team</h2>
      <p className="mb-3 text-sm text-muted">Meetings go to the person who owns the relationship; otherwise to whoever has the lightest week.</p>
      <ul className="divide-y divide-line">
        {data.team.map((t) => (
          <li key={t.user.id} className="py-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{t.user.name}</span>
              {!t.profile ? (
                <span className="badge text-[10px]">Not bookable</span>
              ) : t.profile.unavailableUntil && new Date(t.profile.unavailableUntil) > new Date() ? (
                <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">Away until {t.profile.unavailableUntil.slice(0, 10)}</span>
              ) : !t.profile.acceptsMeetings ? (
                <span className="badge text-[10px]">Paused</span>
              ) : (
                <span className="badge border-brand/25 bg-brand-soft text-[10px] text-brand">Bookable</span>
              )}
            </div>
            {t.profile && <p className="text-xs text-muted">{summary(t.profile)}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Types({ types, canManage, onSaved }: { types: MeetingTypeRow[]; canManage: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function update(t: MeetingTypeRow, change: Partial<MeetingTypeRow>) {
    setBusy(t.id);
    setError(null);
    try {
      await patch(`/meetings/types/${t.id}`, change);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="font-semibold">Meeting types</h2>
      <p className="mb-3 text-sm text-muted">What each meeting needs from the deal before it can be booked, and whether the AI may book it when a prospect picks a time.{canManage ? "" : " Only owners and admins change these."}</p>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-2">
        {types.map((t) => (
          <div key={t.id} className={`grid gap-3 rounded-xl border border-line p-3 text-sm md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] md:items-center ${t.active ? "" : "opacity-60"}`}>
            <div className="min-w-0">
              <div className="font-medium">
                {t.name} {busy === t.id && <Loader className="inline size-3.5 animate-spin" />}
              </div>
              {t.description && <div className="text-xs text-muted">{t.description}</div>}
            </div>
            <label className="text-xs text-muted">
              Duration
              <select className="input mt-1 h-9" disabled={!canManage || busy === t.id} value={t.durationMinutes} onChange={(e) => void update(t, { durationMinutes: Number(e.target.value) })}>
                {[15, 20, 30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted">
              Needs
              <select className="input mt-1 h-9" disabled={!canManage || busy === t.id} value={t.requiredQualification} onChange={(e) => void update(t, { requiredQualification: e.target.value as MeetingQualificationRuleKey })}>
                {MEETING_QUALIFICATION_RULES.map((r) => (
                  <option key={r} value={r}>
                    {MEETING_QUALIFICATION_INFO[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" disabled={!canManage || busy === t.id} checked={t.aiBookingAllowed} onChange={(e) => void update(t, { aiBookingAllowed: e.target.checked })} /> AI may book
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" disabled={!canManage || busy === t.id} checked={t.active} onChange={(e) => void update(t, { active: e.target.checked })} /> Active
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
