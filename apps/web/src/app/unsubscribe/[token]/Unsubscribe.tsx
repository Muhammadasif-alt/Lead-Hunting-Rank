"use client";

import { useState } from "react";
import { CheckCircle2, Loader } from "lucide-react";

/** Confirmation for someone who opened the unsubscribe link in a browser. No account, no questions. */
export function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function confirm() {
    setState("busy");
    try {
      const res = await fetch(`/api/v1/public/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="card mx-auto max-w-md p-6 text-center sm:p-8">
      {state === "done" ? (
        <>
          <CheckCircle2 className="mx-auto size-10 text-brand" />
          <h1 className="mt-4 text-xl font-semibold">You’re unsubscribed</h1>
          <p className="mt-2 text-sm text-muted">
            You won’t get any more emails from this sender. Nothing else is needed.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Unsubscribe?</h1>
          <p className="mt-2 text-sm text-muted">You won’t get any more emails from this sender.</p>
          <button
            type="button"
            className="btn btn-primary mt-6"
            disabled={state === "busy"}
            onClick={() => void confirm()}
          >
            {state === "busy" && <Loader className="size-4 animate-spin" />} Unsubscribe
          </button>
          {state === "error" && (
            <p className="mt-3 text-sm text-danger">
              Something went wrong — please try again, or reply “unsubscribe” to the email.
            </p>
          )}
        </>
      )}
    </div>
  );
}
