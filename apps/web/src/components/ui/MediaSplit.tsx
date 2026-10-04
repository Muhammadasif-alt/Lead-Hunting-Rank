import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Half photo, half content (stacks on mobile: photo first). Photos are square-cornered by design — no radius.
 * Images live in /public/images and come from Pexels (free for commercial use, no attribution required).
 */
export function MediaSplit({
  src,
  alt,
  reverse = false,
  minHeight = 360,
  focus = "center",
  children,
}: {
  src: string;
  alt: string;
  /** Put the photo on the right on wide screens. */
  reverse?: boolean;
  /** Minimum photo height in px; on wide screens it grows to match the content. */
  minHeight?: number;
  /** CSS object-position — which part of the photo stays visible when cropped. */
  focus?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
      <div className={`relative overflow-hidden bg-raised ${reverse ? "lg:order-2" : ""}`} style={{ minHeight }}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
          style={{ objectPosition: focus }}
        />
      </div>
      <div className="flex min-w-0 flex-col justify-center">{children}</div>
    </div>
  );
}
