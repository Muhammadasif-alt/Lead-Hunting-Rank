"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";

const DEV_ACCOUNTS = [
  ["Owner", "owner@rankhighlead.dev"],
  ["Admin", "admin@rankhighlead.dev"],
  ["Sales", "sales@rankhighlead.dev"],
  ["Researcher", "researcher@rankhighlead.dev"],
  ["Viewer", "viewer@rankhighlead.dev"],
] as const;
const DEV_PASSWORD = "rankhighlead-dev";

export function LoginForm({ next, devHint }: { next: string; devHint: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(
        res.status === 400
          ? "Enter your email and password."
          : (body?.error?.message ?? "Sign-in failed. Please try again."),
      );
    } catch {
      setError("Can’t reach the server. Check that the API is running, then try again.");
    }
    setPending(false);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="input mt-1.5 h-11"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <div className="relative mt-1.5">
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input h-11 pr-11"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-faint hover:bg-hover hover:text-fg"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary btn-lg w-full">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {devHint && (
        <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-raised p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-faint">Development accounts</p>
          <p className="mt-1 text-xs text-muted">
            From <code className="font-mono">pnpm db:seed</code> — password <code className="font-mono">{DEV_PASSWORD}</code>. Shown only in development.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DEV_ACCOUNTS.map(([role, addr]) => (
              <button
                key={addr}
                type="button"
                onClick={() => {
                  setEmail(addr);
                  setPassword(DEV_PASSWORD);
                }}
                className="badge cursor-pointer transition-colors hover:border-brand/40 hover:text-fg"
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
