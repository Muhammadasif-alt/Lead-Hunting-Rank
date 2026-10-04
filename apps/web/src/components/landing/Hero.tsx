import Link from "next/link";
import { ArrowRight, Lock, Power, ShieldCheck, Sparkles } from "lucide-react";
import HeroVisual from "./HeroVisual";

const TRUST = [
  { icon: ShieldCheck, label: "Evidence-backed data" },
  { icon: Lock, label: "Policy-controlled AI" },
  { icon: Power, label: "Kill switch built in" },
];

export default function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* backdrop: dotted grid + soft brand/accent glows */}
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_80%_70%_at_30%_10%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-[10%] -z-10 h-[480px] w-[720px] max-w-[140vw] rounded-full bg-brand/12 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 right-0 -z-10 h-[420px] w-[560px] rounded-full bg-accent/10 blur-3xl"
      />

      <div className="mx-auto grid max-w-page items-center gap-12 px-4 pt-14 pb-20 sm:px-6 sm:pt-20 lg:px-8 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] xl:gap-12 xl:pt-16 xl:pb-24">
        <div className="text-center xl:text-left">
          <span className="badge gap-2 bg-surface/60 px-3 backdrop-blur">
            <Sparkles className="size-3.5 text-brand" aria-hidden="true" />
            AI Sales Operating System
          </span>

          <h1
            id="hero-title"
            className="mt-6 text-4xl font-semibold tracking-tight text-balance text-fg sm:text-5xl lg:text-6xl xl:text-[3.9rem] xl:leading-[1.04]"
          >
            Find every lead in your market. <span className="text-gradient">Let AI work them — safely.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-pretty text-muted sm:text-lg xl:mx-0">
            Rank High Lead maps your entire local market, researches each business with evidence, and runs personalized
            outreach through to booked meetings — while a deterministic policy engine keeps you in control of every
            action.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center xl:justify-start">
            <Link href="/lead-hunter" className="btn btn-primary btn-lg w-full sm:w-auto">
              Start hunting leads
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className="btn btn-secondary btn-lg w-full sm:w-auto">
              See how it works
            </a>
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-faint xl:justify-start">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className="size-4 text-muted" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-auto w-full max-w-[880px] xl:max-w-none">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
