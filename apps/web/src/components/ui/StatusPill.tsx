export default function StatusPill({ children, tone = "emerald" }: { children: React.ReactNode; tone?: "emerald" | "amber" | "red" | "muted" }) {
  const tones: Record<string, string> = {
    emerald: "text-[#00ff85] border-[#00ff85]/30 bg-[#00ff85]/10",
    amber: "text-amber-300 border-amber-300/30 bg-amber-300/10",
    red: "text-red-300 border-red-300/30 bg-red-300/10",
    muted: "text-[#7cbfa0] border-[#7cbfa0]/20 bg-white/5",
  };
  return <span className={`pill ${tones[tone]}`}>{children}</span>;
}
