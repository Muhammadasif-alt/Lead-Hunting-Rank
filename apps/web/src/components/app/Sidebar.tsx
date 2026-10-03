"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { SCREEN_GROUPS, SCREENS } from "@/lib/screens";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Logo href="/" size="sm" />
      </div>

      <button
        type="button"
        className="mx-3 mb-2 flex items-center gap-2.5 rounded-lg border border-line bg-raised px-2.5 py-2 text-left transition-colors hover:bg-hover"
        title="Workspaces arrive with authentication (Phase 3)"
      >
        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-xs font-bold text-brand">R</span>
        <span className="flex-1 truncate text-sm font-medium">My workspace</span>
        <ChevronsUpDown className="size-3.5 text-faint" />
      </button>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {SCREEN_GROUPS.map((group) => (
          <div key={group} className="mt-4">
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</div>
            <ul className="space-y-0.5">
              {SCREENS.filter((s) => s.group === group).map((s) => {
                const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
                const Icon = s.icon;
                return (
                  <li key={s.href}>
                    <Link
                      href={s.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                        active ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg"
                      }`}
                    >
                      <Icon className={`size-4 shrink-0 ${active ? "text-brand" : "text-faint group-hover:text-muted"}`} />
                      <span className="truncate">{s.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
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
