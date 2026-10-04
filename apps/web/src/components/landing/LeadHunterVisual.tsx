import Image from "next/image";
import { ArrowUp, ChevronRight, CircleCheck, Info, Mail, MapPin, Phone, Search, Share2, UserRound } from "lucide-react";
import { LinkedinIcon, MiniSidebar } from "./IllustrationKit";
import { ScaledCanvas } from "./ScaledCanvas";

/**
 * Lead Hunter spotlight illustration: a browser window with market stats, the Austin map and verified results,
 * plus a market-coverage card. Fixed 720×600 canvas. Coverage is shown as a confidence level, never a fake
 * "% of the market" (docs/03). All data is illustrative.
 */
const W = 720;
const H = 600;

const STATS = [
  { icon: MapPin, value: "3,482", label: "Businesses found", up: true },
  { icon: Share2, value: "2,871", label: "Unique after dedupe" },
  { icon: UserRound, value: "1,936", label: "Owner contacts" },
  { icon: Mail, value: "1,421", label: "Verified emails" },
];

const RESULTS = [
  { name: "Lone Star Lawns", kind: "Landscaping", img: "/images/hero/house-2.jpg" },
  { name: "Bright Smile Dental", kind: "Dentist", img: "/images/hero/house-3.jpg" },
  { name: "Peak Roofing Co.", kind: "Roofing", img: "/images/hero/house-1.jpg" },
  { name: "CoolAir HVAC", kind: "HVAC", img: "/images/hero/house-4.jpg" },
  { name: "Urban Edge Marketing", kind: "Marketing Agency", img: "/images/hero/house-2.jpg" },
];

// [x%, y%, colour]
const PINS: [number, number, "g" | "b"][] = [
  [18, 12, "g"], [40, 10, "b"], [62, 12, "g"], [30, 24, "g"], [52, 24, "g"], [10, 30, "b"], [76, 34, "b"], [22, 40, "b"],
  [8, 62, "g"], [20, 66, "g"], [38, 68, "g"], [50, 64, "g"], [66, 66, "g"], [82, 62, "b"], [28, 80, "g"], [56, 80, "g"],
  [86, 76, "g"], [12, 84, "b"], [74, 88, "b"],
];

const COVERAGE_BARS = [22, 30, 38, 46, 52, 60, 66, 72, 80, 88, 94];

export default function LeadHunterVisual() {
  return (
    <ScaledCanvas width={W} height={H} max={1.15} caption="Illustration — example data">
      <div className="absolute left-[120px] top-[60px] h-[480px] w-[520px] rounded-full bg-brand/10 blur-3xl" />

      {/* browser window */}
      <div className="absolute overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_30px_70px_-30px_rgb(16_24_20/0.35)]" style={{ left: 0, top: 0, width: W, height: 540 }}>
        <div className="flex h-7 items-center gap-1.5 border-b border-line px-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex h-[calc(100%-28px)]">
          <MiniSidebar />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 flex-1 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[10px] text-muted">
                <Search className="size-3" /> Austin, TX <span className="text-faint">•</span> Landscaping, Dentists, HVAC…
              </div>
              <div className="flex h-8 items-center rounded-lg bg-brand-strong px-4 text-[10px] font-semibold text-white">Search Market</div>
            </div>

            <div className="grid grid-cols-4 divide-x divide-line rounded-lg border border-line py-2">
              {STATS.map(({ icon: Icon, value, label, up }) => (
                <div key={label} className="flex items-start gap-1.5 px-2.5">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                  <div>
                    <div className="text-[14px] font-semibold leading-none tabular-nums">{value}</div>
                    <div className="mt-1 text-[8px] text-muted">{label}</div>
                    {up && (
                      <div className="mt-0.5 flex items-center text-[8px] font-semibold text-brand">
                        <ArrowUp className="size-2.5" /> 94%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-[1fr_1.05fr] gap-2.5">
              {/* map */}
              <div className="relative overflow-hidden rounded-lg border border-line bg-[#eaf2ec]">
                <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100" fill="none">
                  <path d="M0 20 Q30 15 50 30 T100 25" stroke="#d3ddd6" strokeWidth=".7" />
                  <path d="M0 60 Q25 50 45 62 T100 55" stroke="#d3ddd6" strokeWidth=".7" />
                  <path d="M25 0 Q35 40 22 100" stroke="#d3ddd6" strokeWidth=".7" />
                  <path d="M75 0 Q62 50 78 100" stroke="#d3ddd6" strokeWidth=".7" />
                  <path d="M0 92 Q30 82 55 94 T100 88" stroke="#cfe0f3" strokeWidth="2" />
                </svg>
                <div className="absolute left-1/2 top-1/2 size-[190px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15" />
                <div className="absolute left-1/2 top-1/2 size-[110px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15" />
                {PINS.map(([x, y, c]) => (
                  <MapPin
                    key={`${x}-${y}`}
                    className={`absolute size-[18px] -translate-x-1/2 text-white ${c === "g" ? "fill-brand" : "fill-accent"}`}
                    strokeWidth={1.5}
                    style={{ left: `${x}%`, top: `${y}%` }}
                  />
                ))}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface px-3 py-1.5 text-[11px] font-semibold shadow-md">Austin, TX</div>
              </div>

              {/* results */}
              <ul className="flex flex-col gap-1.5">
                {RESULTS.map((r) => (
                  <li key={r.name} className="flex flex-1 items-center gap-2 rounded-lg border border-line px-2">
                    <span className="relative h-9 w-10 shrink-0 overflow-hidden rounded-md">
                      <Image src={r.img} alt="" fill sizes="80px" className="object-cover" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[9.5px] font-semibold">{r.name}</div>
                      <div className="truncate text-[8px] text-muted">
                        {r.kind} • Austin, TX
                      </div>
                      <span className="mt-0.5 inline-flex items-center gap-0.5 rounded bg-brand-soft px-1 text-[7.5px] font-medium text-brand">
                        <CircleCheck className="size-2" /> Verified
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[#2b3a33]">
                      <Phone className="size-3" />
                      <Mail className="size-3" />
                      <LinkedinIcon className="size-3 text-[#0a66c2]" />
                    </div>
                    <ChevronRight className="size-3 text-faint" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* market coverage */}
      <div className="absolute rounded-2xl border border-line bg-surface p-4 shadow-[0_18px_40px_-18px_rgb(16_24_20/0.3)]" style={{ left: 0, top: 428, width: 330, height: 170 }}>
        <div className="flex items-center gap-1 text-[13px] font-semibold">
          Market coverage <Info className="size-3.5 text-faint" />
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div className="flex h-[96px] flex-1 items-end gap-[5px]">
            {COVERAGE_BARS.map((h, i) => (
              <span
                key={i}
                className={`flex-1 rounded-t-sm ${i < 7 ? "bg-linear-to-t from-brand-strong to-brand" : "bg-linear-to-t from-accent to-[#5b9cf0]"}`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex flex-col items-center">
            <div className="grid size-[76px] place-items-center rounded-full bg-[conic-gradient(#128a43_0_85%,#e6e9e7_85%_100%)]">
              <div className="grid size-[62px] place-items-center rounded-full bg-surface text-center">
                <div>
                  <div className="text-[15px] font-bold leading-none text-brand">High</div>
                  <div className="text-[7.5px] text-muted">confidence</div>
                </div>
              </div>
            </div>
            <div className="mt-1.5 text-center text-[10px] font-semibold leading-tight">
              2,871 unique
              <div className="text-[8.5px] font-normal text-muted">of 3,482 found</div>
            </div>
          </div>
        </div>
      </div>
    </ScaledCanvas>
  );
}
