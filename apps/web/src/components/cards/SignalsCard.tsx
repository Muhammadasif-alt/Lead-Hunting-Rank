export default function SignalsCard({ signals }: { signals: { title: string; detail: string; time: string }[] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">Buying Signals</div>
      <div className="mt-3 space-y-3">
        {signals.map((s, i) => (
          <div key={i}>
            <div className="text-sm text-[#a7f3d0]">{s.title}</div>
            <div className="text-xs text-[#7cbfa0]">{s.detail} · {s.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
