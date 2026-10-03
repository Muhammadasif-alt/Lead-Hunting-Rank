export default function ScreenPage({ title, sections }: { title: string; sections: { title: string; body: string }[] }) {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-6">
      <div className="card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>
      {sections.map((sec, i) => (
        <div key={i} className="card p-4">
          <div className="text-sm font-semibold">{sec.title}</div>
          <pre className="mt-2 overflow-x-auto rounded bg-[#00180f]/50 p-3 text-xs text-[#a7f3d0]" style={{ whiteSpace: 'pre-wrap' }}>{sec.body}</pre>
        </div>
      ))}
    </div>
  );
}
