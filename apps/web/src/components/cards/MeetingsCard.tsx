export default function MeetingsCard({ meetings }: { meetings: { title: string; time: string; type: string }[] }) {
  return (
    <div className="card p-4">
      <div className="text-sm font-semibold">Today's Meetings</div>
      <div className="mt-3 space-y-3">
        {meetings.map((m, i) => (
          <div key={i}>
            <div className="text-sm text-[#a7f3d0]">{m.title}</div>
            <div className="text-xs text-[#7cbfa0]">{m.time} · {m.type}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
