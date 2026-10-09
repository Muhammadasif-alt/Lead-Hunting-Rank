"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, CalendarClock, CircleAlert, ClipboardCheck, FileText, Flame, Loader, Settings2, Video } from "lucide-react";
import { MEETING_STATUS_INFO, type PermissionKey } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage } from "@/lib/api";
import { dayHeading, dayKey, relative, STATUS_STYLE, timeOf, whenOf, zoneOf, type MeetingCard, type MeetingList } from "@/lib/meetings";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { Setup } from "./Setup";

type Tab = "upcoming" | "arranging" | "action" | "past" | "setup";

/**
 * Calendar & meetings (screen #8): what is booked (confirmed by the calendar), what is being arranged from conversations,
 * and what needs a person — outcomes to record, no-shows to follow up. Actionable first; priority is evidence, not the
 * clock.
 */
export function Meetings() {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<MeetingList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = tab === "past" ? new Date(start.getTime() - 30 * 86_400_000) : start;
    const to = tab === "past" ? new Date() : new Date(start.getTime() + 21 * 86_400_000);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (mine) params.set("mine", "true");
    try {
      setData(await api<MeetingList>(`/meetings?${params}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [tab, mine]);

  useEffect(() => {
    if (tab !== "setup") void load();
  }, [load, tab]);
  // Bookings confirm in the background (the calendar answers through the worker) — keep the list fresh.
  useEffect(() => {
    if (tab === "setup") return;
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load, tab]);

  const screen = findScreen("/meetings");
  const s = data?.summary;
  const upcoming = (data?.meetings ?? []).filter((m) => tab === "past" || (m.status !== "COMPLETED" && m.status !== "NO_SHOW" && (!m.endAt || new Date(m.endAt) > new Date(Date.now() - 2 * 3_600_000))));

  return (
    <div className="space-y-5" data-tone="sales">
      <PageHeader
        screen={screen}
        actions={
          <button type="button" className={`btn ${tab === "setup" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab("setup")}>
            <Settings2 className="size-4" /> Setup
          </button>
        }
      />

      {s && tab !== "setup" && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Next 24 hours" value={s.next24h} hint="Booked, confirmed" />
          <Stat label="Next 7 days" value={s.next7d} hint="Booked, confirmed" />
          <Stat label="Being arranged" value={s.arranging} hint="Times found or offered" onClick={() => setTab("arranging")} />
          <Stat label="Prep needed" value={s.prepRequired} hint="Within 2 days, brief has gaps" />
          <Stat label="Outcome to record" value={s.needsOutcome} hint="It ended — did it happen?" onClick={() => setTab("action")} warn={s.needsOutcome > 0} />
          <Stat label="No-show follow-ups" value={s.noShowFollowUps} hint="Last 14 days" onClick={() => setTab("action")} warn={s.noShowFollowUps > 0} />
        </div>
      )}

      {tab !== "setup" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Views" className="flex gap-1 overflow-x-auto">
            {(
              [
                ["upcoming", "Upcoming"],
                ["arranging", `Being arranged${s?.arranging ? ` · ${s.arranging}` : ""}`],
                ["action", `Needs action${s && s.needsOutcome + s.noShowFollowUps ? ` · ${s.needsOutcome + s.noShowFollowUps}` : ""}`],
                ["past", "Past 30 days"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${tab === key ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine
          </label>
        </div>
      )}

      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {tab === "setup" ? (
        <Setup canManageTypes={can("policy.manage")} canBook={can("meeting.book")} onBack={() => setTab("upcoming")} />
      ) : !data ? (
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            {tab === "upcoming" || tab === "past" ? (
              <Agenda meetings={upcoming} past={tab === "past"} />
            ) : tab === "arranging" ? (
              <Simple list={data.arranging} empty="Nothing being arranged. When a prospect asks to meet, the free times appear here and in the inbox." />
            ) : (
              <Simple list={data.needsAction} empty="Nothing waiting — every past meeting has its outcome." />
            )}
          </div>
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
            <NextMeeting m={data.next} />
            <section className="card p-4 text-xs text-muted">
              <div className="eyebrow mb-1.5 text-[11px]">How booking works</div>
              <p>Free times come from the calendar itself, inside each person’s working hours — checked again right before booking.</p>
              <p className="mt-1.5">A meeting shows as booked only after the calendar confirms the event. Cancellations and no-shows never close the deal by themselves.</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, onClick, warn }: { label: string; value: number; hint: string; onClick?: () => void; warn?: boolean }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${warn ? "text-amber" : ""}`}>{value}</div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-4 text-left hover:border-line-strong">
      {body}
    </button>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

function Agenda({ meetings, past }: { meetings: MeetingCard[]; past: boolean }) {
  if (!meetings.length)
    return (
      <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
        <CalendarCheck className="size-8 text-tone" />
        <p className="font-medium">{past ? "No meetings in the last 30 days" : "No booked meetings coming up"}</p>
        <p className="max-w-sm text-sm text-muted">Meetings appear here once the calendar confirms them. Requests from prospects start in the inbox and under “Being arranged”.</p>
      </div>
    );
  const ordered = past ? [...meetings].reverse() : meetings;
  const days: { key: string; heading: string; items: MeetingCard[] }[] = [];
  for (const m of ordered) {
    const at = m.startAt ?? m.createdAt;
    const key = dayKey(at);
    const day = days.find((d) => d.key === key) ?? (days.push({ key, heading: dayHeading(at), items: [] }), days[days.length - 1]!);
    day.items.push(m);
  }
  return (
    <>
      {days.map((d) => (
        <section key={d.key} aria-label={d.heading}>
          <h2 className="mb-2 text-sm font-semibold">{d.heading}</h2>
          <ul className="space-y-2">
            {d.items.map((m) => (
              <li key={m.id}>
                <Row m={m} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Row({ m }: { m: MeetingCard }) {
  const at = m.startAt ?? m.pendingStartAt;
  return (
    <Link href={`/meetings/${m.id}`} className={`card flex flex-col gap-2 p-3.5 hover:border-line-strong sm:flex-row sm:items-start ${m.priority === "HIGH" ? "border-tone/30" : ""}`}>
      <div className="w-24 shrink-0">
        {at ? (
          <>
            <div className="text-sm font-semibold tabular-nums">{timeOf(at)}</div>
            <div className="text-[11px] text-faint">{m.endAt ? `– ${timeOf(m.endAt)}` : ""}</div>
          </>
        ) : (
          <div className="text-xs text-muted">No time yet</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {m.priority === "HIGH" && <Flame className="size-3.5 text-tone" aria-label="Priority" />}
          <span className="truncate text-sm font-medium">{m.company?.name ?? m.title}</span>
          <span className={`badge text-[10px] ${STATUS_STYLE[m.status]}`}>{MEETING_STATUS_INFO[m.status].label}</span>
        </div>
        <div className="truncate text-xs text-muted">
          {m.typeName}
          {m.contact ? ` · ${m.contact}` : ""}
          {m.owner?.name ? ` · with ${m.owner.name}` : ""}
        </div>
        {m.highlights.length > 0 && <div className="mt-1 text-xs text-tone">{m.highlights.join(" · ")}</div>}
        <div className="mt-1 text-xs text-faint">{m.nextAction}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
        {m.opportunity && <span className="badge text-[10px]">{m.opportunity.stageName}</span>}
        {m.brief ? (
          <span className={`badge text-[10px] ${m.brief.gaps > 1 ? "border-amber/30 bg-amber-soft text-amber" : ""}`}>
            <FileText className="size-3" /> Brief{m.brief.gaps > 1 ? ` · ${m.brief.gaps} gaps` : ""}
          </span>
        ) : null}
        {m.meetingUrl && (
          <span className="badge text-[10px]">
            <Video className="size-3" /> Link
          </span>
        )}
        {m.needsOutcome && (
          <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">
            <ClipboardCheck className="size-3" /> Outcome
          </span>
        )}
      </div>
    </Link>
  );
}

function Simple({ list, empty }: { list: MeetingCard[]; empty: string }) {
  if (!list.length) return <p className="card px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {list.map((m) => (
        <li key={m.id}>
          <Row m={m} />
        </li>
      ))}
    </ul>
  );
}

function NextMeeting({ m }: { m: MeetingCard | null }) {
  return (
    <section className="card p-4">
      <div className="eyebrow mb-1.5 flex items-center gap-1.5 text-[11px]">
        <CalendarClock className="size-3.5" /> Next meeting
      </div>
      {!m || !m.startAt ? (
        <p className="text-sm text-muted">Nothing booked yet.</p>
      ) : (
        <>
          <p className="text-sm font-semibold">{m.company?.name ?? m.title}</p>
          <p className="text-xs text-muted">
            {m.typeName} · {whenOf(m.startAt)} ({relative(m.startAt)})
          </p>
          {m.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone && (
            <p className="text-[11px] text-faint">
              Their time: {timeOf(m.startAt, m.timezone)} {zoneOf(m.timezone, m.startAt)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/meetings/${m.id}#brief`} className="btn btn-primary text-xs">
              <FileText className="size-3.5" /> Open brief
            </Link>
            {m.meetingUrl && (
              <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary text-xs">
                <Video className="size-3.5" /> Join
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}
