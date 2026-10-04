import Link from "next/link";
import { Logo } from "../brand/Logo";

type FooterLink = { label: string; href: string; anchor?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Lead Hunter", href: "/lead-hunter" },
      { label: "AI Inbox", href: "/inbox" },
      { label: "Campaigns", href: "/campaigns" },
      { label: "Analytics", href: "/analytics" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "AI Sales Manager", href: "/ai-manager" },
      { label: "AI Control Center", href: "/ai-control" },
      { label: "Integrations", href: "/integrations" },
      { label: "System health", href: "/diagnostics" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "How it works", href: "#how-it-works", anchor: true },
      { label: "Safety", href: "#safety", anchor: true },
      { label: "FAQ", href: "#faq", anchor: true },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#", anchor: true },
      { label: "Contact", href: "#", anchor: true },
      { label: "Privacy", href: "#", anchor: true },
      { label: "Terms", href: "#", anchor: true },
    ],
  },
];

const linkClass = "text-sm text-muted transition-colors hover:text-fg";

export default function Footer() {
  return (
    <footer className="border-t border-line bg-surface/40">
      <div className="mx-auto max-w-page px-4 pt-16 pb-10 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              The AI Sales Operating System — from market discovery to booked meetings, with policy-controlled autonomy.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-4">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <h3 className="text-xs font-semibold tracking-wider text-fg uppercase">{col.title}</h3>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.anchor ? (
                        <a href={l.href} className={linkClass}>
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className={linkClass}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Rank High Lead. All rights reserved.</p>
          <p className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
            Built with policy-controlled AI
          </p>
        </div>
      </div>
    </footer>
  );
}
