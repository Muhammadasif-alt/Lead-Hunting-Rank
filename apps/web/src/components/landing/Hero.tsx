export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden rounded-b-[3rem] bg-gradient-to-b from-[#000d08] via-[#00261a] to-[#004d2c] px-6 py-20 text-white">
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1 text-xs text-white/80">
            ⚡ AI Sales Operating System
          </span>
          <h1 className="mt-6 text-4xl md:text-5xl font-bold leading-tight">
            The AI-powered<br />business operating system
          </h1>
          <p className="mt-4 text-white/70 max-w-md">
            Capture, nurture, close new leads into bookings, sales, reviews and repeat customers—all with AI-first workflows.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="/dashboard" className="inline-flex items-center justify-center rounded-lg bg-[#00ff85] px-6 py-3 text-sm font-semibold text-[#000d08] hover:bg-[#00e676]">
              Start Free Trial
            </a>
            <a href="/dashboard" className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-6 py-3 text-sm text-white hover:bg-white/20">
              View Dashboard
            </a>
          </div>
        </div>
        <div className="hidden md:block">
          <div className="rounded-2xl bg-white/10 p-6 text-sm text-white/80 backdrop-blur">
            <div className="rounded-lg bg-white/10 p-4 mb-4">Revenue OS Overview</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {["New Prospects 143","High Intent 18","Conversations 27","Meetings 4","Pipeline $82K","Human Needed 3"].map((label) => (
                <div key={label} className="rounded-md bg-white/10 p-3">{label}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
