"use client";

import { useState } from "react";

const tabs = ["Capture", "Nurture", "Close", "Evangelize", "Reactivate"];

export default function FeaturesTabs() {
  const [active, setActive] = useState(0);
  const content = [
    { title: "Get more leads in the door", body: "Attract the right people, turn interest into leads and keep your pipeline full.", list: ["CRM", "Voice AI", "Forms & Quizzes", "Websites & Landing Pages", "Webinar Funnels", "Chat Widget / AI", "Missed Call Text-Back", "QR Codes", "Prospecting Tool"] },
    { title: "Nurture with automation", body: "Automated follow-ups that feel human.", list: ["Workflows", "Email", "SMS", "WhatsApp", "Appointments", "Review Requests", "Facebook DM", "Instagram DM"] },
    { title: "Close with intelligence", body: "Turn conversations into meetings and meetings into revenue.", list: ["Opportunities", "Calendar", "Meeting Notes", "Proposals", "Payment Links", "Pipeline"] },
    { title: "Evangelize your brand", body: "Turn customers into advocates.", list: ["Reviews", "Listings", "Reputation", "Testimonials", "Referrals"] },
    { title: "Reactivate past leads", body: "Win back dormant contacts with smart campaigns.", list: ["Re-engagement", "Past Customers", "Cold Lists", "Win-Back", "Seasonal Offers"] },
  ];

  return (
    <section className="bg-white px-6 py-20 text-black">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-bold">Your all-in-one solution for business growth</h2>
        <p className="mt-3 text-center text-gray-600">All the tools you need in one AI-powered platform</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {tabs.map((t, i) => (
            <button key={t} onClick={() => setActive(i)} className={`rounded-xl border px-6 py-3 text-sm font-semibold ${active === i ? "border-yellow-400 bg-yellow-300/20 text-black" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="mt-10 rounded-[2rem] border border-gray-100 bg-gray-50 p-8 md:p-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-2xl font-bold">{content[active].title}</h3>
              <p className="mt-3 text-gray-600">{content[active].body}</p>
              <div className="mt-6 grid grid-cols-2 gap-2">
                {content[active].list.map((li) => (
                  <div key={li} className="flex items-center gap-2 text-sm text-gray-800">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-white text-xs">✓</span>
                    {li}
                  </div>
                ))}
              </div>
              <a href="/dashboard" className="mt-8 inline-block rounded-lg bg-black px-6 py-3 text-sm font-semibold text-white hover:bg-gray-900">Start 14 Day Free Trial</a>
            </div>
            <div className="rounded-2xl bg-white p-6 text-sm text-gray-500 shadow-inner">
              <div className="rounded-lg bg-blue-600 text-white p-4 text-xs">Sorry we missed your call! Want to book an appointment?</div>
              <div className="mt-8 rounded-lg border border-gray-200 p-4 text-gray-400">Type your message...</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
