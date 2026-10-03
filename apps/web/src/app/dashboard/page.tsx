import Sidebar from "../../components/layout/Sidebar";
import Topbar from "../../components/layout/Topbar";
import KpiCard from "../../components/cards/KpiCard";
import BriefingCard from "../../components/cards/BriefingCard";
import AttentionCard from "../../components/cards/AttentionCard";
import MissionCard from "../../components/cards/MissionCard";
import PipelineCard from "../../components/cards/PipelineCard";
import SignalsCard from "../../components/cards/SignalsCard";
import MeetingsCard from "../../components/cards/MeetingsCard";
import CampaignsCard from "../../components/cards/CampaignsCard";

export default function Dashboard() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col">
        <Topbar />
        <div className="flex flex-1 flex-col gap-6 p-6">
          <section className="card p-4">
            <h1 className="text-xl font-semibold">Good morning</h1>
            <p className="mt-1 text-sm text-[#7cbfa0]">3 decisions need you. 2 meetings today.</p>
            <input
              placeholder="Ask AI Sales Manager anything..."
              className="mt-4 w-full rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none placeholder:text-[#7cbfa0] focus:border-[#00ff85]/40"
            />
          </section>

          <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="New Prospects" value="143" sub="+31 today" />
            <KpiCard label="High Intent" value="18" sub="5 new" />
            <KpiCard label="Conversations" value="27" sub="8 active" />
            <KpiCard label="Meetings" value="4" sub="2 today" />
            <KpiCard label="Open Pipeline" value="$82K" sub="14 deals" />
            <KpiCard label="Human Needed" value="3" sub="1 urgent" />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BriefingCard
              title="AI Sales Manager Briefing"
              items={[
                "142 new prospects discovered overnight",
                "8 replies processed, 2 meeting requests",
                "Primary bottleneck: contact verification",
                "Recommended focus: pricing approval for GreenScape",
              ]}
            />
            <div className="grid grid-cols-1 gap-4">
              <AttentionCard title="GreenScape custom pricing" reason="Potential opportunity: $18K. Waiting 42 min." severity="critical" />
              <AttentionCard title="Campaign cohort ready" reason="AI recommends expanding 75 → 200 prospects." severity="medium" />
            </div>
          </div>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MissionCard title="Map Austin landscaping market" status="RUNNING" detail="Decision-maker enrichment in progress" />
            <MissionCard title="Verify 24 decision makers" status="QUEUED" detail="Waiting for provider capacity" />
            <MissionCard title="Refresh website audits" status="BACKGROUND" detail="Low priority recurring job" />
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <PipelineCard stages={[{ name: "New", count: 12, value: "$28K" }, { name: "Qualified", count: 6, value: "$41K" }, { name: "Proposal", count: 3, value: "$46K" }]} />
            <SignalsCard signals={[{ title: "GreenScape", detail: "New commercial page", time: "3h ago" }, { title: "Lawn Experts", detail: "Hiring 3 crews", time: "1d ago" }]} />
            <MeetingsCard meetings={[{ title: "GreenScape", time: "10:30 AM", type: "Discovery" }, { title: "LawnPro", time: "2:00 PM", type: "Review" }]} />
            <CampaignsCard campaigns={[{ name: "Austin No Website", replies: 14, meetings: 4, pipeline: "$24K" }, { name: "Weak Website", replies: 7, meetings: 2, pipeline: "$12K" }]} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-4">
              <div className="text-sm font-semibold">Hot Prospects</div>
              <div className="mt-3 space-y-3">
                {[
                  { name: "GreenScape Landscaping", detail: "Owner identified · High digital opportunity" },
                  { name: "Austin Lawn Experts", detail: "No website · 173 reviews" },
                  { name: "Texas Outdoor Living", detail: "Hiring React devs · Active FB/IG" },
                ].map((p) => (
                  <div key={p.name}>
                    <div className="text-sm text-[#a7f3d0]">{p.name}</div>
                    <div className="text-xs text-[#7cbfa0]">{p.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-sm font-semibold">Live AI Activity</div>
              <div className="mt-3 space-y-3 text-xs text-[#7cbfa0]">
                {[
                  "10:42 Research Agent researching GreenScape",
                  "10:41 Lead Hunter found 14 new Austin landscapers",
                  "10:40 Contact Agent verified owner email for LawnPro",
                  "10:38 Conversation Agent classified reply as MEETING_REQUEST",
                ].map((a) => (
                  <div key={a} className="border-l border-[#00ff85]/20 pl-3">{a}</div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <div className="text-sm font-semibold">Active Markets</div>
              <div className="mt-3 space-y-3">
                {[
                  { name: "Austin Landscapers", count: "1,842 companies", status: "Monitoring" },
                  { name: "Dallas Roofers", count: "1,431 companies", status: "Discovering" },
                  { name: "Houston HVAC", count: "1,824 companies", status: "Monitoring" },
                ].map((m) => (
                  <div key={m.name}>
                    <div className="text-sm text-[#a7f3d0]">{m.name}</div>
                    <div className="text-xs text-[#7cbfa0]">{m.count} · {m.status}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
