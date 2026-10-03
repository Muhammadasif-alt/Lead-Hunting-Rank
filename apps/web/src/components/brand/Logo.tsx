import Link from "next/link";

/** The three rising arrows from the Rank High Lead logo, as a crisp SVG. */
export function LogoMark({ className = "h-6 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" className={className} aria-hidden="true">
      <path d="M2 40 L11 30 L20 40 H14.5 V54 H7.5 V40 Z" fill="#FFBD2E" />
      <path d="M20 26 L30 15 L40 26 H33.8 V54 H26.2 V26 Z" fill="#1D8FFF" />
      <path d="M40 12 L51 1 L62 12 H55 V54 H47 V12 Z" fill="#22D14A" />
    </svg>
  );
}

/** Full wordmark: arrows + "Rank High Lead". */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" | "lg" }) {
  const text = { sm: "text-[15px]", md: "text-[17px]", lg: "text-2xl" }[size];
  const mark = { sm: "h-[18px] w-auto", md: "h-5 w-auto", lg: "h-7 w-auto" }[size];
  return (
    <Link href={href} className="inline-flex items-center gap-2" aria-label="Rank High Lead — home">
      <LogoMark className={mark} />
      <span className={`${text} font-extrabold tracking-tight leading-none`}>
        <span className="text-fg">Rank</span>
        <span className="text-brand">High</span>
        <span className="text-accent">Lead</span>
      </span>
    </Link>
  );
}
