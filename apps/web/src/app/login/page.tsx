import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/me";
import { TONES, TONE_ORDER } from "@/lib/screens";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await getMe()) redirect(next);

  return (
    <div className="relative min-h-screen bg-canvas">
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]"
      />
      <header className="relative mx-auto flex h-16 max-w-page items-center px-4 sm:px-6">
        <Logo />
      </header>

      <main className="relative mx-auto grid max-w-page items-center gap-10 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[minmax(0,440px)_1fr] lg:gap-16 lg:pt-16">
        <section className="card p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in to your workspace.</p>
          <LoginForm next={next} devHint={process.env.NODE_ENV !== "production"} />
        </section>

        <aside className="hidden lg:block">
          <p className="eyebrow">Inside the app</p>
          <h2 className="mt-3 max-w-md text-3xl font-semibold tracking-tight">
            Every area has its own colour, so you always know <span className="text-gradient">where you are.</span>
          </h2>
          <ul className="mt-8 grid max-w-lg grid-cols-2 gap-3">
            {TONE_ORDER.map((tone) => (
              <li key={tone} data-tone={tone} className="card flex items-start gap-3 p-4">
                <span aria-hidden="true" className="mt-1 size-2.5 shrink-0 rounded-full bg-tone ring-4 ring-tone-soft" />
                <span>
                  <span className="block text-sm font-medium text-tone">{TONES[tone].label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{TONES[tone].description}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
