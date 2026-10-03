export default function BriefingCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-3 space-y-2 text-sm text-[#a7f3d0]">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[#00ff85]">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
