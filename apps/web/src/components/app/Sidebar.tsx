"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { SCREEN_GROUPS, SCREENS, TONE_ORDER, TONES } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const me = useMe();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo href="/" size="sm" />
      </div>

      <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-2" title={me.workspace.name}>
        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-xs font-bold text-brand">
          {me.workspace.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{me.workspace.name}</span>
          <span className="block truncate text-[11px] text-faint">
            {me.roles.map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(", ")}
          </span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SCREEN_GROUPS.map((group) => (
          <div key={group} className="mt-4">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</div>
            <ul className="space-y-0.5">
              {SCREENS.filter((s) => s.group === group).map((s) => {
                const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
                const Icon = s.icon;
                return (
                  <li key={s.href} data-tone={s.tone}>
                    <Link
                      href={s.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={`${s.title} · ${TONES[s.tone].label}`}
                      className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                        active ? "bg-tone-soft font-medium text-fg" : "text-muted hover:bg-hover/60 hover:text-fg"
                      }`}
                    >
                      {active && (
                        <span aria-hidden="true" className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-full bg-tone" />
                      )}
                      <Icon className={`size-4 shrink-0 text-tone ${active ? "" : "opacity-75 group-hover:opacity-100"}`} />
                      <span className="truncate">{s.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Colour code legend — teaches new team members what each tone means. */}
      <div className="border-t border-line px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Colour code</div>
        <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5">
          {TONE_ORDER.map((t) => (
            <li key={t} data-tone={t} className="flex items-center gap-1.5 text-[11px] text-muted" title={`${TONES[t].label} — ${TONES[t].description}`}>
              <span className="size-2 shrink-0 rounded-full bg-tone" />
              <span className="truncate">{TONES[t].short}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-line bg-surface lg:block">
      <SidebarNav />
    </aside>
  );
}
