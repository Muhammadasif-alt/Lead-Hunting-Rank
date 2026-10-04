"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Sidebar, SidebarNav } from "./Sidebar";
import { Topbar } from "./Topbar";
import { screenForPath } from "@/lib/screens";

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const tone = screenForPath(pathname)?.tone ?? "leads";

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface shadow-2xl">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="btn btn-ghost absolute right-2 top-2.5 px-2"
              aria-label="Close navigation"
            >
              <X className="size-5" />
            </button>
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* The area tone colours accents (icons, badges, focus) for everything on this page. */}
      <div data-tone={tone} className="relative flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 bg-linear-to-r from-tone via-tone/50 to-transparent" />
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-5 sm:py-8">
          {/* Content starts right next to the sidebar (no centring gap) and stops at the 1440px page width. */}
          <div className="w-full max-w-page">{children}</div>
        </main>
      </div>
    </div>
  );
}
