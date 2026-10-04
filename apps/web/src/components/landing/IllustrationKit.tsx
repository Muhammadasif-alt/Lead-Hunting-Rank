import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { BarChart3, Calendar, Crosshair, LayoutDashboard, MessageSquare, Send, Settings } from "lucide-react";

/**
 * Building blocks for the landing-page illustrations (Hero, How it works). Each illustration is drawn on a fixed
 * canvas and scaled to its container, so elements keep their positions at any width.
 */

export function Card({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute rounded-2xl border border-line bg-surface shadow-[0_18px_40px_-18px_rgb(16_24_20/0.25)] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/** Headshots from /public/images/hero (Pexels). */
export const people = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => `/images/hero/person-${((from + i) % 8) + 1}.jpg`);

export function Avatars({ srcs, size = 30 }: { srcs: string[]; size?: number }) {
  return (
    <div className="flex">
      {srcs.map((src, i) => (
        <span
          key={src}
          className="relative -ml-2 overflow-hidden rounded-full border-2 border-surface first:ml-0"
          style={{ width: size, height: size, zIndex: srcs.length - i }}
        >
          <Image src={src} alt="" fill sizes={`${size * 3}px`} className="scale-[1.6] object-cover object-[50%_18%]" />
        </span>
      ))}
    </div>
  );
}

export function LinkedinIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="currentColor" />
      <path
        fill="#fff"
        d="M7.1 9.6h2.3V17H7.1zM8.25 6a1.33 1.33 0 1 1 0 2.66 1.33 1.33 0 0 1 0-2.66zM10.9 9.6h2.2v1h.03c.3-.58 1.06-1.2 2.18-1.2 2.33 0 2.76 1.53 2.76 3.53V17h-2.3v-3.57c0-.85-.02-1.95-1.19-1.95-1.19 0-1.37.93-1.37 1.89V17h-2.3z"
      />
    </svg>
  );
}

export function ArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="7"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0 10 5 0 10z" fill="#128a43" />
      </marker>
    </defs>
  );
}

/** The mini app sidebar used inside laptop mock-ups. */
export function MiniSidebar() {
  const nav = [
    { icon: LayoutDashboard, label: "Dashboard" },
    { icon: Crosshair, label: "Lead Hunter", active: true },
    { icon: Send, label: "Campaigns" },
    { icon: MessageSquare, label: "Messages" },
    { icon: Calendar, label: "Calendar" },
    { icon: BarChart3, label: "Reports" },
    { icon: Settings, label: "Settings" },
  ];
  return (
    <div className="w-[118px] shrink-0 border-r border-line bg-raised/60 px-2.5 py-3">
      <div className="flex items-center gap-1 px-1 text-[11px] font-bold">
        <span className="flex items-end gap-px">
          <span className="h-1.5 w-1 rounded-sm bg-amber" />
          <span className="h-2.5 w-1 rounded-sm bg-brand" />
          <span className="h-3.5 w-1 rounded-sm bg-accent" />
        </span>
        <span>
          Rank<span className="text-brand">High</span>
          <span className="text-accent">Lead</span>
        </span>
      </div>
      <ul className="mt-5 space-y-1">
        {nav.map(({ icon: Icon, label, active }) => (
          <li
            key={label}
            className={`flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[9.5px] ${active ? "bg-brand-soft font-medium text-brand" : "text-muted"}`}
          >
            <Icon className="size-3" /> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
