import Image from "next/image";
import { CalendarCheck, CircleCheck, Mail, MailCheck, MapPin, Search } from "lucide-react";
import { Avatars, MiniSidebar, people } from "./IllustrationKit";

/**
 * Lead Hunter dashboard mock-up (stats, map, results table) shared by the landing illustrations.
 * Natural size 640×440; parents position/scale it. All data is illustrative.
 */
export const DASHBOARD_W = 640;
export const DASHBOARD_H = 440;

const STATS = [
  { value: "1,284", label: "Businesses found", badge: "↑ 94%" },
  { value: "471", label: "Owner contacts", icon: MailCheck, avatars: true },
  { value: "338", label: "Verified emails", icon: Mail },
  { value: "127", label: "Meetings booked", icon: CalendarCheck },
];

const ROWS = [
  {
    name: "GreenScape Landscaping",
    img: "/images/hero/house-1.jpg",
    status: "Replied",
    tone: "bg-brand-soft text-brand",
  },
  {
    name: "Lone Star Lawns",
    img: "/images/hero/house-2.jpg",
    status: "Meeting",
    tone: "bg-accent-soft text-accent",
  },
  {
    name: "Hill Country Outdoors",
    img: "/images/hero/house-3.jpg",
    status: "Closed",
    tone: "bg-brand-soft text-brand",
  },
  {
    name: "Urban Edge Landscaping",
    img: "/images/hero/house-4.jpg",
    status: "Follow up",
    tone: "bg-accent-soft text-accent",
  },
];

const PINS = [
  [10, 16],
  [30, 10],
  [52, 8],
  [72, 14],
  [88, 10],
  [18, 34],
  [40, 30],
  [62, 36],
  [82, 32],
  [8, 58],
  [26, 76],
  [50, 70],
  [76, 78],
  [90, 60],
];

function Sparkline() {
  return (
    <svg viewBox="0 0 60 18" className="mt-1.5 h-4 w-full" fill="none" preserveAspectRatio="none">
      <path d="M0 15 C 10 14, 14 9, 22 11 S 36 6, 42 8 S 54 3, 60 2" stroke="#1aa553" strokeWidth="1.5" />
      <path d="M0 15 C 10 14, 14 9, 22 11 S 36 6, 42 8 S 54 3, 60 2 V18 H0z" fill="#1aa553" fillOpacity=".1" />
    </svg>
  );
}

export default function DashboardMock({ cta = "Find Leads" }: { cta?: string }) {
  return (
    <div
      className="flex overflow-hidden rounded-2xl border border-line bg-surface"
      style={{ width: DASHBOARD_W, height: DASHBOARD_H }}
    >
      <MiniSidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[9.5px] text-faint">
            <Search className="size-3" /> Search businesses, locations or industries…
          </div>
          <div className="flex h-8 items-center rounded-lg bg-brand-strong px-4 text-[10px] font-semibold text-white">
            {cta}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {STATS.map(({ value, label, badge, icon: Icon, avatars }) => (
            <div key={label} className="rounded-lg border border-line p-2">
              <div className="flex items-start justify-between">
                <div className="text-[14px] font-semibold leading-none tabular-nums">{value}</div>
                {badge ? (
                  <span className="rounded bg-brand-soft px-1 text-[7.5px] font-semibold text-brand">{badge}</span>
                ) : Icon ? (
                  <span className="grid size-4 place-items-center rounded bg-brand-soft text-brand">
                    <Icon className="size-2.5" />
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[8px] text-muted">{label}</div>
              {avatars ? (
                <div className="mt-1 flex items-center gap-1">
                  <Avatars srcs={people(0, 5)} size={14} />
                  <span className="text-[7px] font-medium text-muted">+466</span>
                </div>
              ) : (
                <Sparkline />
              )}
            </div>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[0.95fr_1.25fr] gap-2.5">
          {/* map */}
          <div className="relative overflow-hidden rounded-lg border border-line bg-[#eaf2ec]">
            <svg
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
              fill="none"
            >
              <path d="M0 25 Q30 20 50 35 T100 30" stroke="#d3ddd6" strokeWidth=".8" />
              <path d="M0 65 Q25 55 45 68 T100 60" stroke="#d3ddd6" strokeWidth=".8" />
              <path d="M30 0 Q35 40 25 100" stroke="#d3ddd6" strokeWidth=".8" />
              <path d="M72 0 Q60 50 76 100" stroke="#d3ddd6" strokeWidth=".8" />
              <path d="M0 88 Q30 78 55 90 T100 84" stroke="#cfe0f3" strokeWidth="2" />
            </svg>
            {PINS.map(([x, y]) => (
              <MapPin
                key={`${x}-${y}`}
                className="absolute size-[18px] -translate-x-1/2 fill-brand text-white"
                strokeWidth={1.5}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            ))}
            <div className="absolute left-[12%] top-[42%] flex gap-2 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
              <span className="relative h-[42px] w-[46px] shrink-0 overflow-hidden rounded">
                <Image src="/images/hero/house-4.jpg" alt="" fill sizes="92px" className="object-cover" />
              </span>
              <div className="pr-1">
                <div className="text-[9px] font-semibold leading-tight">Precision Landscapes</div>
                <div className="text-[7.5px] text-muted">Austin, TX</div>
                <span className="mt-1 inline-flex items-center gap-0.5 rounded bg-brand-soft px-1 text-[7px] font-medium text-brand">
                  <CircleCheck className="size-2" /> Verified
                </span>
              </div>
            </div>
          </div>

          {/* results */}
          <div className="flex flex-col rounded-lg border border-line">
            <div className="grid grid-cols-[1fr_auto] px-2.5 py-1.5 text-[7.5px] text-faint">
              <span>Business · Location</span>
              <span>Status</span>
            </div>
            {ROWS.map((r) => (
              <div
                key={r.name}
                className="grid flex-1 grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-line px-2.5"
              >
                <span className="relative h-6 w-7 overflow-hidden rounded">
                  <Image src={r.img} alt="" fill sizes="56px" className="object-cover" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[8.5px] font-medium">{r.name}</div>
                  <div className="text-[7.5px] text-muted">Austin, TX</div>
                </div>
                <span className={`rounded px-2 py-0.5 text-[7.5px] font-medium ${r.tone}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
