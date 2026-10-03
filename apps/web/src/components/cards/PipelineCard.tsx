export default function PipelineCard({ stages }: { stages: { name: string; count: number; value: string }[] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">Pipeline</div>
      <div className="mt-3 space-y-2">
        {stages.map((s) => (
          <div key={s.name} className="flex items-center justify-between text-sm">
            <span className="text-[#a7f3d0]">{s.name}</span>
            <span className="text-[#7cbfa0]">{s.count} · {s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
