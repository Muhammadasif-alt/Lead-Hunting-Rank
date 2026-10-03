import StatusPill from "../ui/StatusPill";

export default function AttentionCard({ title, reason, severity }: { title: string; reason: string; severity: "critical" | "high" | "medium" }) {
  const tone = severity === "critical" ? "red" : severity === "high" ? "amber" : "emerald";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <StatusPill tone={tone}>{severity}</StatusPill>
      </div>
      <p className="mt-2 text-xs text-[#7cbfa0]">{reason}</p>
    </div>
  );
}
