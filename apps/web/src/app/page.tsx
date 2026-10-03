import type { Metadata } from "next";
import Navbar from "../components/landing/Navbar";
import Hero from "../components/landing/Hero";
import HowItWorks from "../components/landing/HowItWorks";
import Features from "../components/landing/Features";
import LeadHunterSpotlight from "../components/landing/LeadHunterSpotlight";
import Agents from "../components/landing/Agents";
import Safety from "../components/landing/Safety";
import FAQ from "../components/landing/FAQ";
import CTA from "../components/landing/CTA";
import Footer from "../components/landing/Footer";

export const metadata: Metadata = {
  title: { absolute: "Rank High Lead — AI Sales Operating System" },
  description:
    "Find every business in your market, research them with evidence, and let AI agents run outreach to booked meetings — with policy-controlled autonomy and a built-in kill switch.",
};

export default function Home() {
  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <LeadHunterSpotlight />
        <Agents />
        <Safety />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
