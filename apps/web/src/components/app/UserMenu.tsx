"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { useMe } from "@/lib/session-context";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Avatar with the signed-in user, their role and sign-out. */
export function UserMenu() {
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const role = me.roles[0] ?? "VIEWER";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full p-0.5 pr-2 transition-colors hover:bg-hover"
      >
        <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand ring-1 ring-brand/20">
          {initials(me.user.name)}
        </span>
        <span className="hidden text-sm font-medium lg:inline">{me.user.name.split(" ")[0]}</span>
      </button>

      {open && (
        <div role="menu" className="card absolute right-0 top-11 z-30 w-64 p-1.5">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{me.user.name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="badge">{role.charAt(0) + role.slice(1).toLowerCase()}</span>
              <span className="truncate text-xs text-faint">{me.workspace.name}</span>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-hover hover:text-fg"
          >
            {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
