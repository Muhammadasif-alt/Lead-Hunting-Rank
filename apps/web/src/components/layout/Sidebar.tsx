"use client";

const items = [
  { label: "Command Center", href: "/dashboard" },
  { label: "AI Sales Manager", href: "/ai-manager" },
  { label: "Lead Hunter", href: "/lead-hunter" },
  { label: "Companies", href: "/companies" },
  { label: "Inbox", href: "/inbox" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "Pipeline", href: "/pipeline" },
  { label: "Meetings", href: "/meetings" },
  { label: "Signals", href: "/signals" },
  { label: "Analytics", href: "/analytics" },
  { label: "Experiments", href: "/experiments" },
  { label: "Memory", href: "/memory" },
  { label: "Knowledge", href: "/knowledge" },
  { label: "Tasks", href: "/tasks" },
  { label: "Integrations", href: "/integrations" },
  { label: "Team", href: "/team" },
  { label: "AI Control", href: "/ai-control" },
  { label: "Settings", href: "/settings" },
  { label: "System Health", href: "/diagnostics" },
];

export default function Sidebar() {
  return (
    <aside className="hidden w-56 flex-col border-r border-[#00ff85]/10 bg-[#000d08]/70 p-4 md:flex">
      <div className="mb-6 text-lg font-semibold text-[#00ff85]">Revenue OS</div>
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <a key={it.label} href={it.href} className="rounded-md px-3 py-2 text-sm text-[#a7f3d0] hover:bg-[#00ff85]/10 hover:text-white">
            {it.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
