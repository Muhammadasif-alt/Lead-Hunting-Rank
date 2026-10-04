import Image from "next/image";
import { CircleCheck, Clock, Mail, MapPin, MessageSquareText, Phone, Plus, Search } from "lucide-react";
import DashboardMock, { DASHBOARD_H, DASHBOARD_W } from "./DashboardMock";
import { ArrowMarker, Card, LinkedinIcon } from "./IllustrationKit";
import { ScaledCanvas } from "./ScaledCanvas";

/**
 * "How it works" illustration: pick markets and industries → the Lead Hunter dashboard → actions across channels
 * → activity. Fixed 780×600 canvas, scaled to its column. Data is illustrative.
 */
const W = 780;
const H = 600;

const LOCATIONS = ["New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX", "Phoenix, AZ"];
const INDUSTRIES = ["Landscaping", "HVAC", "Roofing", "Real Estate", "Dentists", "Home Services"];
const CHANNELS = [
  { label: "Email", icon: <Mail className="size-4 text-accent" /> },
  { label: "LinkedIn", icon: <LinkedinIcon className="size-4 text-[#0a66c2]" /> },
  { label: "SMS", icon: <MessageSquareText className="size-4 text-brand" /> },
  { label: "Call", icon: <Phone className="size-4 text-[#db2777]" /> },
];
const ACTIVITY = [
  { label: "Personalized email sent", sub: "Just now", icon: <Mail className="size-4 text-accent" /> },
  { label: "Follow-up in 3 days", icon: <Clock className="size-4 text-muted" /> },
  { label: "LinkedIn message queued", icon: <LinkedinIcon className="size-4 text-[#0a66c2]" /> },
  { label: "Call task created", icon: <Phone className="size-4 text-brand" /> },
];
const GLOBE_PINS = [
  [70, 330], [128, 370], [96, 440], [180, 420], [150, 500], [220, 470],
];
const DASH_SCALE = 0.8;

export default function HowItWorksVisual() {
  return (
    <ScaledCanvas width={W} height={H} max={1.2} caption="Illustration — example data">
      {/* globe backdrop */}
      <div className="absolute left-[-10px] top-[260px] size-[330px] rounded-full bg-[radial-gradient(circle_at_35%_35%,#e7f6ff,#cfe9f7_45%,#bfe3d1)] shadow-[inset_0_-20px_40px_rgb(18_138_67/0.15)]" />
      <div className="absolute left-[-40px] top-[520px] h-[60px] w-[400px] rounded-[50%] bg-brand/10 blur-md" />
      {GLOBE_PINS.map(([x, y]) => (
        <MapPin key={`${x}-${y}`} className="absolute size-9 fill-brand text-white drop-shadow" strokeWidth={1.2} style={{ left: x, top: y }} />
      ))}

      <svg className="absolute inset-0 overflow-visible" width={W} height={H} fill="none">
        <ArrowMarker id="hw-arrow" />
        <path d="M150 20 C 200 -10, 250 -5, 290 30" stroke="#128a43" strokeWidth="2.5" strokeDasharray="3 6" strokeLinecap="round" markerEnd="url(#hw-arrow)" />
        <path d="M740 300 C 770 330, 770 360, 760 380" stroke="#128a43" strokeWidth="2.5" strokeDasharray="3 6" strokeLinecap="round" markerEnd="url(#hw-arrow)" />
      </svg>

      {/* laptop with the dashboard */}
      <div className="absolute" style={{ left: 190, top: 60, perspective: 1600 }}>
        <div
          className="rounded-[20px] border-[8px] border-[#1d2420] bg-[#1d2420] shadow-[0_30px_60px_-25px_rgb(16_24_20/0.45)]"
          style={{ transform: "rotateY(-10deg) rotateX(4deg)", transformOrigin: "50% 50%" }}
        >
          <div style={{ width: DASHBOARD_W * DASH_SCALE, height: DASHBOARD_H * DASH_SCALE }} className="overflow-hidden rounded-xl">
            <div style={{ transform: `scale(${DASH_SCALE})`, transformOrigin: "top left" }}>
              <DashboardMock cta="Hunt Leads" />
            </div>
          </div>
        </div>
        <div className="mx-[-24px] h-4 rounded-b-2xl bg-linear-to-b from-[#e3e7e4] to-[#c9d0cc] shadow-lg" />
      </div>

      {/* locations */}
      <Card className="p-3" style={{ left: 10, top: 40, width: 176 }}>
        <ul className="space-y-2">
          {LOCATIONS.map((l) => (
            <li key={l} className="flex items-center gap-2 text-[12px] text-fg">
              <MapPin className="size-4 fill-brand text-white" strokeWidth={1.5} /> {l}
            </li>
          ))}
        </ul>
        <div className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-brand">
          <Plus className="size-3.5" /> Add location
        </div>
      </Card>

      {/* industries */}
      <Card className="p-3" style={{ left: 40, top: 360, width: 186 }}>
        <div className="flex items-center justify-between rounded-lg bg-raised px-2 py-1.5 text-[11.5px] font-medium">
          <span className="flex items-center gap-1.5">
            <Search className="size-3.5" /> Any industry
          </span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {INDUSTRIES.map((ind) => (
            <li key={ind} className="flex items-center gap-2 px-1 text-[11.5px] text-muted">
              <span className="size-3 rounded-sm border border-line-strong" /> {ind}
            </li>
          ))}
        </ul>
      </Card>

      {/* lead card */}
      <Card className="flex gap-2.5 p-2.5" style={{ left: 552, top: 0, width: 228 }}>
        <span className="relative h-[54px] w-[56px] shrink-0 overflow-hidden rounded-lg">
          <Image src="/images/hero/house-1.jpg" alt="" fill sizes="112px" className="object-cover" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold leading-tight">GreenScape Landscaping</div>
          <div className="text-[9.5px] text-muted">Austin, TX</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5 rounded bg-brand-soft px-1 text-[8.5px] font-medium text-brand">
              <CircleCheck className="size-2.5" /> Verified email
            </span>
            <Phone className="size-3 text-brand" />
            <LinkedinIcon className="size-3 text-[#0a66c2]" />
          </div>
        </div>
      </Card>

      {/* channels */}
      <Card className="p-3" style={{ left: 560, top: 110, width: 200 }}>
        <div className="text-[13px] font-semibold">Take action</div>
        <ul className="mt-2 divide-y divide-line">
          {CHANNELS.map((c) => (
            <li key={c.label} className="flex items-center gap-2 py-2 text-[12px]">
              {c.icon}
              <span className="flex-1">{c.label}</span>
              <CircleCheck className="size-4 fill-brand text-white" />
            </li>
          ))}
        </ul>
      </Card>

      {/* activity */}
      {ACTIVITY.map((a, i) => (
        <Card key={a.label} className="flex items-center gap-2.5 px-3 py-2.5" style={{ left: 560 + (i % 2) * 6, top: 390 + i * 52, width: 214 }}>
          {a.icon}
          <div>
            <div className="text-[11.5px] font-medium">{a.label}</div>
            {a.sub && <div className="text-[9.5px] text-faint">{a.sub}</div>}
          </div>
        </Card>
      ))}
    </ScaledCanvas>
  );
}
