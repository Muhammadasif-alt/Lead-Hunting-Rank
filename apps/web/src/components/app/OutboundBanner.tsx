"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OctagonX, PauseCircle } from "lucide-react";
import { OUTBOUND_INFO } from "@revenue-os/shared";
import { api } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import type { OutboundInfo } from "@/lib/policy";

/** Fired after the kill switch changes on this page, so the banner updates at once instead of on its next poll. */
export const OUTBOUND_CHANGED = "rhl:outbound-changed";

/**
 * Kill switch banner on every screen (screen #17 §82-87): who stopped outbound, when and why. Hidden while outbound is
 * on. Polls, so a stop made by someone else shows up within half a minute.
 */
export function OutboundBanner() {
  const [info, setInfo] = useState<OutboundInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api<OutboundInfo>("/policy/outbound"));
    } catch {
      // Banner only — a failed poll keeps the last known state.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const onChange = () => void load();
    window.addEventListener(OUTBOUND_CHANGED, onChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(OUTBOUND_CHANGED, onChange);
    };
  }, [load]);

  if (!info || info.state === "ACTIVE") return null;
  const stop = info.state === "EMERGENCY_STOP";
  const Icon = stop ? OctagonX : PauseCircle;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-5 ${stop ? "border-danger/30 bg-danger text-white" : "border-amber/30 bg-amber-soft text-fg"}`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="font-semibold">{OUTBOUND_INFO[info.state].label}</span>
      <span className={stop ? "text-white/90" : "text-muted"}>
        Nothing is being sent{info.reason ? ` — ${info.reason}` : ""}
        {info.changedBy ? ` · by ${info.changedBy}` : ""}
        {info.changedAt ? ` · ${formatAgo(info.changedAt)}` : ""}
      </span>
      <Link
        href="/ai-control"
        className={`ml-auto font-medium underline-offset-2 hover:underline ${stop ? "text-white" : "text-accent"}`}
      >
        Open AI Control Center
      </Link>
    </div>
  );
}
