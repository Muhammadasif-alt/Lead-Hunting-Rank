"use client";

import Image from "next/image";
import { ArrowMarker, Avatars, Card, LinkedinIcon, MiniSidebar, people } from "./IllustrationKit";
import { ScaledCanvas } from "./ScaledCanvas";
import {
  ArrowRight,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Mail,
  MailCheck,
  MapPin,
  Phone,
  Search,
} from "lucide-react";

/**
 * Hero illustration: the hunt → research → outreach → meetings flow around a Lead Hunter screen.
 * Drawn on a fixed 880×720 canvas and scaled to its container, so every element keeps its place at any width.
 * All names and numbers are illustrative (labelled below the canvas). Photos: Pexels, free for commercial use.
 */
const W = 880;
const H = 720;

const STEPS = [
  { icon: MapPin, title: "Find Businesses", sub: "In any city or niche" },
  { icon: Search, title: "Research with AI", sub: "Website, social, data" },
  { icon: MailCheck, title: "Outreach Automatically", sub: "Personalized & safe" },
  { icon: CalendarDays, title: "Book Meetings", sub: "Real opportunities" },
];

const BUSINESSES = [
  { name: "GreenScape Landscaping", img: "/images/hero/house-1.jpg" },
  { name: "Lone Star Lawns", img: "/images/hero/house-2.jpg" },
  { name: "Hill Country Outdoors", img: "/images/hero/house-3.jpg" },
  { name: "Precision Landscapes", img: "/images/hero/house-4.jpg" },
];

// Map pins, as % of the map area.
const PINS = [
  [8, 22],
  [20, 38],
  [33, 30],
  [46, 18],
  [58, 34],
  [72, 22],
  [12, 58],
  [28, 66],
  [40, 52],
  [52, 62],
  [66, 54],
  [80, 44],
  [88, 70],
  [62, 82],
];

const BARS = [28, 40, 34, 52, 46, 62, 58, 74, 66, 84, 78, 96];

export default function HeroVisual() {
  return (
    <ScaledCanvas width={W} height={H} caption="Illustration — example data">
      {/* soft glow behind the laptop */}
      <div className="absolute left-[180px] top-[220px] h-[420px] w-[560px] rounded-full bg-brand/15 blur-3xl" />

      {/* connector arrows */}
      <svg className="absolute inset-0 overflow-visible" width={W} height={H} fill="none">
        <ArrowMarker id="hv-arrow" />
        {/* laptop → first step */}
        <path
          d="M118 238 C 70 190, 70 110, 120 72"
          stroke="#128a43"
          strokeOpacity=".55"
          strokeWidth="2.5"
          markerEnd="url(#hv-arrow)"
        />
        {/* results list → book meetings */}
        <path
          d="M884 540 C 915 590, 905 630, 876 652"
          stroke="#128a43"
          strokeOpacity=".7"
          strokeWidth="2.5"
          markerEnd="url(#hv-arrow)"
        />
        {/* contacts → book meetings */}
        <path
          d="M560 640 C 590 680, 615 684, 652 676"
          stroke="#128a43"
          strokeOpacity=".7"
          strokeWidth="2.5"
          markerEnd="url(#hv-arrow)"
        />
        {/* sparkle strokes */}
        <path
          d="M846 158 l6 -24 M862 170 l18 -16 M866 190 l24 -2"
          stroke="#128a43"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      {/* step cards */}
      {STEPS.map(({ icon: Icon, title, sub }, i) => (
        <div key={title}>
          <Card className="p-4" style={{ left: 130 + i * 186, top: 0, width: 150, height: 132 }}>
            <span
              className={`grid size-8 place-items-center ${i === 2 ? "rounded-md bg-brand text-white" : "text-brand"}`}
            >
              <Icon className={i === 2 ? "size-5" : "size-7"} strokeWidth={i === 2 ? 2 : 2.4} />
            </span>
            <div className="mt-2.5 text-[16px] font-semibold leading-tight text-fg">{title}</div>
            <div className="mt-1 text-[12px] text-muted">{sub}</div>
          </Card>
          {i < STEPS.length - 1 && (
            <ArrowRight
              className="absolute size-6 text-brand"
              style={{ left: 286 + i * 186, top: 54 }}
              strokeWidth={2.5}
            />
          )}
        </div>
      ))}

      {/* laptop */}
      <div className="absolute" style={{ left: 96, top: 172, width: 560, height: 400, perspective: 1600 }}>
        <div
          className="relative h-full w-full overflow-hidden rounded-[18px] border-[6px] border-[#eef1ef] bg-surface shadow-[0_30px_60px_-25px_rgb(16_24_20/0.35)]"
          style={{
            transform: "rotateY(-14deg) rotateX(6deg) rotateZ(-2deg)",
            transformOrigin: "60% 50%",
          }}
        >
          <div className="flex h-full">
            <MiniSidebar />
            {/* app main */}
            <div className="flex min-w-0 flex-1 flex-col p-3">
              <div className="flex items-center gap-2 pr-16">
                <div className="flex h-7 flex-1 items-center gap-1.5 rounded-md border border-line px-2 text-[9.5px] text-muted">
                  <Search className="size-3" /> Austin, TX · Landscapers
                </div>
                <div className="flex h-7 items-center rounded-md bg-brand-strong px-3 text-[9.5px] font-semibold text-white">
                  Hunt Leads
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 pr-16">
                {[
                  ["Business type", "Landscapers"],
                  ["Location", "Austin, TX"],
                  ["Radius", "25 miles"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-[8px] text-faint">{label}</div>
                    <div className="mt-0.5 flex h-6 items-center justify-between rounded-md border border-line px-1.5 text-[9px]">
                      {value} <ChevronDown className="size-2.5 text-faint" />
                    </div>
                  </div>
                ))}
              </div>
              {/* map */}
              <div className="relative mt-2.5 flex-1 overflow-hidden rounded-lg border border-line bg-[#eef3ef]">
                <svg
                  className="absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                  fill="none"
                >
                  <path d="M0 30 Q30 25 50 40 T100 35" stroke="#d6dfd8" strokeWidth=".8" />
                  <path d="M0 70 Q25 60 45 72 T100 65" stroke="#d6dfd8" strokeWidth=".8" />
                  <path d="M30 0 Q35 40 25 100" stroke="#d6dfd8" strokeWidth=".8" />
                  <path d="M70 0 Q60 50 75 100" stroke="#d6dfd8" strokeWidth=".8" />
                  <path d="M0 50 L100 55" stroke="#e1e8e3" strokeWidth="1.6" />
                  <path d="M50 0 L55 100" stroke="#e1e8e3" strokeWidth="1.6" />
                  <path d="M10 90 Q40 80 60 90 T100 88" stroke="#dce6f5" strokeWidth="1.2" />
                </svg>
                {PINS.map(([x, y]) => (
                  <MapPin
                    key={`${x}-${y}`}
                    className="absolute size-5 -translate-x-1/2 -translate-y-full fill-brand text-white"
                    strokeWidth={1.5}
                    style={{ left: `${x}%`, top: `${y + 12}%` }}
                  />
                ))}
                <div className="absolute left-[30%] top-[10%] flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[11px] font-semibold shadow-md">
                  <MapPin className="size-4 fill-brand text-white" /> 328 businesses found
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* laptop base */}
        <div
          className="absolute -bottom-3 left-[-30px] h-4 w-[600px] rounded-b-2xl bg-linear-to-b from-[#e7ebe8] to-[#d5dbd7] shadow-lg"
          style={{ transform: "rotateZ(-2deg)" }}
        />
      </div>

      {/* businesses discovered */}
      <Card className="p-4" style={{ left: 40, top: 470, width: 250, height: 150 }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[24px] font-semibold leading-none tabular-nums">1,284</div>
            <div className="mt-1 text-[12px] text-muted">Businesses discovered</div>
          </div>
          <span className="flex items-center gap-0.5 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand">
            <ArrowUp className="size-3" /> 94%
          </span>
        </div>
        <div className="mt-3 flex h-[62px] items-end gap-[5px]">
          {BARS.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-sm bg-linear-to-t from-brand-strong to-brand"
              style={{ height: `${h}%`, opacity: 0.55 + i * 0.04 }}
            />
          ))}
        </div>
      </Card>

      {/* owner contacts */}
      <Card className="p-4" style={{ left: 350, top: 540, width: 220, height: 128 }}>
        <div className="text-[24px] font-semibold leading-none tabular-nums">471</div>
        <div className="mt-1 text-[12px] text-muted">Owner contacts found</div>
        <div className="mt-3 flex items-center gap-2">
          <Avatars srcs={people(0, 5)} />
          <span className="text-[11px] font-medium text-muted">+466</span>
        </div>
      </Card>

      {/* results list */}
      {BUSINESSES.map((b, i) => (
        <Card
          key={b.name}
          className="flex items-center gap-3 p-2.5"
          style={{ left: 596, top: 168 + i * 100, width: 284, height: 90 }}
        >
          <span className="relative h-[66px] w-[62px] shrink-0 overflow-hidden rounded-lg">
            <Image src={b.img} alt="" fill sizes="124px" className="object-cover" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="whitespace-nowrap text-[11.5px] font-semibold">{b.name}</div>
            <div className="text-[10px] text-muted">Austin, TX</div>
            <span className="mt-1.5 inline-flex rounded-md bg-brand-soft px-1.5 py-0.5 text-[9.5px] font-medium text-brand">
              Verified email
            </span>
          </div>
          <div className="flex items-center gap-2.5 pr-1.5 text-[#2b3a33]">
            <Phone className="size-3.5" />
            <Mail className="size-3.5" />
            <span className="text-[#0a66c2]">
              <LinkedinIcon />
            </span>
          </div>
        </Card>
      ))}

      {/* book more meetings */}
      <Card className="flex items-center gap-3 p-4" style={{ left: 662, top: 610, width: 214, height: 108 }}>
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-white">
          <CalendarDays className="size-6" />
        </span>
        <div className="flex-1">
          <div className="text-[15px] font-semibold leading-tight">Book more meetings</div>
          <div className="mt-2">
            <Avatars srcs={people(5, 3)} size={26} />
          </div>
        </div>
        <ChevronRight className="size-4 text-muted" />
      </Card>
    </ScaledCanvas>
  );
}
