import type { ReactNode } from "react";

/** Consistent eyebrow + heading + lede used at the top of every landing section. */
export default function SectionHeader({
  eyebrow,
  title,
  lede,
  align = "center",
  id,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: "center" | "left";
  id?: string;
}) {
  const alignment = align === "center" ? "mx-auto text-center" : "text-left";
  return (
    <div className={`max-w-2xl ${alignment}`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {title}
      </h2>
      {lede ? <p className="mt-4 text-base leading-relaxed text-muted sm:text-lg">{lede}</p> : null}
    </div>
  );
}
