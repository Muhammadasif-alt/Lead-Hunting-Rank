export default function PlaceholderScreen({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-screen flex-col gap-6 p-6">
      <div className="card p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-[#7cbfa0]">{description}</p>
      </div>
      <div className="card p-4">
        <div className="text-sm text-[#00ff85]">UI design will follow the locked spec in <code className="text-[#a7f3d0]">docs/screens/</code>.</div>
      </div>
    </div>
  );
}
