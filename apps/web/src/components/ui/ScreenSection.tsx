export default function ScreenSection({ title, description }: { title: string; description: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-2 text-xs text-[#7cbfa0]">{description}</p>
    </div>
  );
}
