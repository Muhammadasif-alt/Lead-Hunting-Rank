export default function MissionCard({ title, status, detail }: { title: string; status: string; detail: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs text-[#00ff85]">{status}</div>
      <p className="mt-2 text-xs text-[#7cbfa0]">{detail}</p>
    </div>
  );
}
