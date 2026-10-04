"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "../brand/Logo";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#lead-hunter", label: "Lead Hunter" },
  { href: "#safety", label: "Safety" },
  { href: "#faq", label: "FAQ" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-200 ${
        solid ? "border-line bg-canvas/80 backdrop-blur-xl" : "border-transparent bg-transparent"
      }`}
    >
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-page items-center justify-between gap-6 px-4 sm:px-6 lg:px-8"
      >
        <Logo />

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn btn-primary">
            Open app
          </Link>
        </div>

        <button
          type="button"
          className="btn btn-ghost -mr-2 px-2 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </nav>

      {open ? (
        <div id="mobile-menu" className="border-t border-line md:hidden">
          <ul className="mx-auto flex max-w-page flex-col px-4 py-3 sm:px-6">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-2.5 text-[15px] text-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mx-auto flex max-w-page gap-2 border-t border-line px-4 py-4 sm:px-6">
            <Link href="/login" className="btn btn-secondary flex-1" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link href="/dashboard" className="btn btn-primary flex-1" onClick={() => setOpen(false)}>
              Open app
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
