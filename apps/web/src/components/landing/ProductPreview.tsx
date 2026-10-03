import { Check, MapPin, Search, X } from "lucide-react";

/**
 * Hand-built mock of the Lead Hunter "Market Exhaust" screen.
 * All numbers and business names are illustrative and clearly labeled "Example".
 */

const STATS = [
  { label: "Discovered", value: "1,284" },
  { label: "Unique", value: "1,036" },
  { label: "No website", value: "312" },
  { label: "Owner found", value: "471" },
  { label: "Verified email", value: "338" },
];

type Row = {
  name: string;
  area: string;
  website: boolean;
  owner: string | null;
  email: "verified" | "unverified" | null;
  score: number;
  signal?: boolean;
};

const ROWS: Row[] = [
  { name: "Lone Star Lawn Co.", area: "East Austin", website: false, owner: "M. Alvarez", email: "verified", score: 92, signal: true },
  { name: "Greenline Landscaping", area: "Round Rock", website: true, owner: "J. Patel", email: "verified", score: 84 },
  { name: "Hill Country Yards", area: "Cedar Park", website: true, owner: "R. Nguyen", email: "unverified", score: 71 },
  { name: "Barton Creek Gardens", area: "South Austin", website: false, owner: null, email: null, score: 66 },
  { name: "Capitol Turf & Tree", area: "Pflugerville", website: true, owner: "D. Brooks", email: "verified", score: 58 },
];

function scoreTone(score: number) {
  if (score >= 80) return "bg-brand-soft text-brand";
  if (score >= 65) return "bg-accent-soft text-accent";
  return "bg-amber-soft text-amber";
}

export default function ProductPreview() {
  return (
    <figure
      aria-label="Example of the Lead Hunter market exhaust screen"
      className="card relative overflow-hidden text-left"
    >
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-line bg-raised/60 px-4 py-3">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted">
          <MapPin className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
          <span className="truncate">
            <span className="font-medium text-fg">Market Exhaust</span> · Austin, TX · Landscapers
          </span>
        </div>
        <span className="badge shrink-0 text-[11px] uppercase tracking-wider text-faint">Example</span>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {/* mode + query */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs" role="presentation">
            <span className="rounded-md px-2.5 py-1 text-muted">Quick</span>
            <span className="rounded-md px-2.5 py-1 text-muted">Deep</span>
            <span className="rounded-md bg-raised px-2.5 py-1 font-medium text-fg">Exhaust Market</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs text-muted">
            <Search className="size-3.5 text-faint" aria-hidden="true" />
            <span className="truncate">Owner identified + verified email</span>
          </div>
        </div>

        {/* coverage stats */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
          {STATS.map((s) => (
            <div key={s.label} className="bg-surface px-3 py-2.5">
              <dt className="text-[11px] text-faint">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-fg">{s.value}</dd>
            </div>
          ))}
          <div className="bg-surface sm:hidden" aria-hidden="true" />
        </dl>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
          <span>
            Sources searched <span className="font-mono text-fg">8/8</span>
          </span>
          <span>
            Queries exhausted <span className="font-mono text-fg">94%</span>
          </span>
          <span className="flex items-center gap-2">
            Estimated coverage
            <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand">HIGH</span>
          </span>
        </div>

        {/* businesses */}
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-raised/50 text-[11px] uppercase tracking-wider text-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Business</th>
                <th scope="col" className="px-3 py-2 font-medium">Website</th>
                <th scope="col" className="px-3 py-2 font-medium">Owner</th>
                <th scope="col" className="px-3 py-2 font-medium">Email</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">ICP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROWS.map((r) => (
                <tr key={r.name} className="transition-colors hover:bg-hover/60">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-fg">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                      {r.area}
                      {r.signal ? (
                        <span className="rounded-full bg-amber-soft px-1.5 py-px font-medium text-amber">
                          🔥 No website → opportunity
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.website ? (
                      <Check className="size-4 text-brand" aria-label="Has website" />
                    ) : (
                      <X className="size-4 text-danger" aria-label="No website" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{r.owner ?? <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5">
                    {r.email === "verified" ? (
                      <span className="text-brand">Verified</span>
                    ) : r.email === "unverified" ? (
                      <span className="text-amber">Unverified</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`inline-block rounded px-1.5 py-0.5 font-mono font-semibold tabular-nums ${scoreTone(r.score)}`}>
                      {r.score}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-faint">Every fact stores its source and last-checked date. Illustrative data.</p>
      </div>
    </figure>
  );
}
