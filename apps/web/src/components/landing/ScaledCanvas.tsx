"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Scales a fixed-size canvas to the container width (never above `max`). Hidden until measured to avoid a jump. */
export function ScaledCanvas({
  width,
  height,
  max = 1.1,
  caption,
  children,
}: {
  width: number;
  height: number;
  max?: number;
  caption?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(Math.min(max, el.clientWidth / width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, max]);

  return (
    <figure className="m-0">
      <div
        ref={ref}
        className="relative w-full"
        style={scale === null ? { aspectRatio: `${width} / ${height}` } : { height: height * scale }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left transition-opacity duration-300"
          style={{
            width,
            height,
            transform: `scale(${scale ?? 0.6})`,
            opacity: scale === null ? 0 : 1,
          }}
          aria-hidden="true"
        >
          {children}
        </div>
      </div>
      {caption && <figcaption className="mt-2 text-right text-[11px] text-faint">{caption}</figcaption>}
    </figure>
  );
}
