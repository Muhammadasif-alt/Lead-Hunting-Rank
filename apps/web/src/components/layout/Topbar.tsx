import StatusPill from "../ui/StatusPill";

export default function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-[#00ff85]/10 bg-[#000d08]/70 px-6 py-3">
      <div className="text-sm text-[#7cbfa0]">Command Center</div>
      <div className="flex items-center gap-3">
        <StatusPill tone="emerald">AI ACTIVE</StatusPill>
        <button className="card px-3 py-1 text-xs text-[#a7f3d0]">Pause Outreach</button>
      </div>
    </header>
  );
}
