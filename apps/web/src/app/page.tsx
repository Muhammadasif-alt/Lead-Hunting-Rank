import Hero from "../components/landing/Hero";
import FeaturesTabs from "../components/landing/FeaturesTabs";
import Testimonial from "../components/landing/Testimonial";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#000d08]">
      <Hero />
      <FeaturesTabs />
      <Testimonial />
      <footer className="bg-[#000d08] px-6 py-12 text-center text-xs text-[#7cbfa0]">
        © 2026 Revenue OS. All rights reserved.
      </footer>
    </main>
  );
}
