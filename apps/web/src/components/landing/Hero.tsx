import Link from "next/link";
import { ArrowRight, Lock, Power, ShieldCheck, Sparkles } from "lucide-react";
import ProductPreview from "./ProductPreview";

const TRUST = [
  { icon: ShieldCheck, label: "Evidence-backed data" },
  { icon: Lock, label: "Policy-controlled AI" },
  { icon: Power, label: "Kill switch built in" },
];

export default function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* backdrop: grid fading out + soft brand glow */}
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[480px] w-[880px] max-w-[140vw] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-24 left-[65%] -z-10 h-[280px] w-[420px] rounded-full bg-accent/10 blur-3xl"
      />

      <div className="mx-auto max-w-page px-4 pt-20 pb-24 sm:px-6 sm:pt-28 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="badge gap-2 bg-surface/60 px-3 backdrop-blur">
            <Sparkles className="size-3.5 text-brand" aria-hidden="true" />
            AI Sales Operating System
          </span>

          <h1
            id="hero-title"
            className="mt-6 text-4xl font-semibold tracking-tight text-balance text-fg sm:text-5xl lg:text-6xl lg:leading-[1.05]"
          >
            Find every lead in your market. <span className="text-gradient">Let AI work them — safely.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-muted sm:text-lg">
            Rank High Lead maps your entire local market, researches each business with evidence, and runs
            personalized outreach through to booked meetings — while a deterministic policy engine keeps you in
            control of every action.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/lead-hunter" className="btn btn-primary btn-lg w-full sm:w-auto">
              Start hunting leads
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a href="#how-it-works" className="btn btn-secondary btn-lg w-full sm:w-auto">
              See how it works
            </a>
          </div>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-faint">
            {TRUST.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className="size-4 text-muted" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto mt-16 max-w-5xl sm:mt-20">
          <div
            aria-hidden="true"
            className="absolute -inset-x-6 -inset-y-6 -z-10 rounded-[28px] bg-linear-to-b from-brand/10 via-transparent to-transparent blur-2xl"
          />
          <ProductPreview />
        </div>
      </div>
    </section>
  );
}
