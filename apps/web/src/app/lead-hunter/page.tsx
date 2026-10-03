"use client";

import Sidebar from "../../components/layout/Sidebar";
import Topbar from "../../components/layout/Topbar";

export default function LeadHunter() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col">
        <Topbar />
        <div className="flex flex-1 flex-col gap-6 p-6">
          <div className="card p-4">
            <h1 className="text-xl font-semibold">Lead Hunter</h1>
            <p className="mt-1 text-sm text-[#7cbfa0]">Define your market and discover businesses.</p>
            <form className="mt-4 flex flex-col gap-3 md:flex-row flex-wrap" onSubmit={(e) => e.preventDefault()}>
              <input placeholder="What market do you want to find?" className="flex-1 min-w-[220px] rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none placeholder:text-[#7cbfa0]" />
              <select className="rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none text-[#a7f3d0] pr-8">
                <option>Country</option>
                <option>United States</option>
                <option>United Kingdom</option>
                <option>Canada</option>
              </select>
              <select className="rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none text-[#a7f3d0] pr-8">
                <option>State</option>
                <option>Texas</option>
                <option>California</option>
                <option>New York</option>
              </select>
              <select className="rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none text-[#a7f3d0] pr-8">
                <option>City/Area</option>
                <option>Austin</option>
                <option>Dallas</option>
                <option>Houston</option>
              </select>
              <select className="rounded-lg border border-[#00ff85]/10 bg-[#00180f]/60 px-4 py-3 text-sm outline-none text-[#a7f3d0] pr-8">
                <option>Business type</option>
                <option>Landscaping</option>
                <option>Roofing</option>
                <option>HVAC</option>
              </select>
              <button className="rounded-lg bg-[#00ff85] px-6 py-3 text-sm font-semibold text-[#000d08]">Hunt Leads</button>
            </form>
            <div className="mt-4 flex gap-3 text-sm">
              <label><input type="radio" name="mode" defaultChecked className="mr-1" />Quick Hunt</label>
              <label><input type="radio" name="mode" className="mr-1" />Deep Hunt</label>
              <label><input type="radio" name="mode" className="mr-1" />Market Exhaust</label>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Discovered Businesses</div>
              <span className="pill text-[#00ff85] border-[#00ff85]/30 bg-[#00ff85]/10">693 unique</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[#7cbfa0] border-b border-[#00ff85]/10">
                    <th className="py-2">Business</th>
                    <th className="py-2">Website</th>
                    <th className="py-2">Owner</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Score</th>
                  </tr>
                </thead>
                <tbody className="text-[#a7f3d0]">
                  {[
                    ["GreenScape", "✓", "✓", "✓", "91"],
                    ["Austin Lawn Co", "✕", "✓", "✓", "96"],
                    ["Perfect Turf", "✓", "?", "✓", "76"],
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-[#00ff85]/5 hover:bg-[#00ff85]/5 transition-colors">
                      {row.map((cell, j) => (
                        <td key={j} className="py-3">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
