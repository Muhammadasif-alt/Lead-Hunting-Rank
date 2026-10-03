"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { SCREENS } from "@/lib/screens";

/** Quick navigation: filters screens as you type; ⌘K / Ctrl+K focuses it. */
function ScreenSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SCREENS.slice(0, 6);
    return SCREENS.filter((s) => `${s.title} ${s.group} ${s.summary}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    router.push(href);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter" && results[active]) go(results[active].href);
          else if (e.key === "Escape") inputRef.current?.blur();
        }}
        placeholder="Jump to…"
        aria-label="Search screens"
        role="combobox"
        aria-expanded={open}
        aria-controls="screen-search-results"
        className="input h-9 pl-9 pr-14"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
        Ctrl K
      </kbd>
      {open && results.length > 0 && (
        <ul
          id="screen-search-results"
          role="listbox"
          className="card absolute inset-x-0 top-11 z-30 overflow-hidden p-1.5"
        >
          {results.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.href} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(s.href)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm ${
                    i === active ? "bg-hover" : ""
                  }`}
                >
                  <Icon className="size-4 text-faint" />
                  <span className="flex-1 text-fg">{s.title}</span>
                  <span className="text-xs text-faint">{s.group}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const screen = SCREENS.find((s) => pathname.startsWith(s.href));

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-md sm:px-6">
      <button type="button" onClick={onOpenMenu} className="btn btn-ghost -ml-2 px-2 lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="hidden min-w-0 items-center gap-2 text-sm md:flex">
        <span className="text-faint">{screen?.group ?? "App"}</span>
        <span className="text-faint">/</span>
        <span className="truncate font-medium">{screen?.title ?? ""}</span>
      </div>
      <div className="flex flex-1 justify-end md:justify-center">
        <ScreenSearch />
      </div>
      <div className="hidden w-40 justify-end md:flex">
        <div
          className="grid size-8 place-items-center rounded-full bg-raised text-xs font-semibold text-muted ring-1 ring-line-strong"
          title="Sign-in arrives with authentication (Phase 3)"
        >
          You
        </div>
      </div>
    </header>
  );
}
