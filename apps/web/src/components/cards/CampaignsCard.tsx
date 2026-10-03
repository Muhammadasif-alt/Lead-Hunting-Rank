export default function CampaignsCard({ campaigns }: { campaigns: { name: string; replies: number; meetings: number; pipeline: string }[] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">Campaigns</div>
      <div className="mt-3 space-y-3">
        {campaigns.map((c, i) => (
          <div key={i}>
            <div className="text-sm text-[#a7f3d0]">{c.name}</div>
            <div className="text-xs text-[#7cbfa0]">{c.replies} replies · {c.meetings} meetings · {c.pipeline}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
