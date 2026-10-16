import Image from "next/image";
import { cn } from "@/components/ui";

/**
 * Zicon Technology logo. The source artwork has a white background, so on dark
 * surfaces it sits on a white tile to keep the maroon/amber legible.
 */
export function BrandLogo({ className, onDark = false, priority = false }: { className?: string; onDark?: boolean; priority?: boolean }) {
  const img = (
    <Image
      src="/zicon-logo.jpeg"
      alt="Zicon Technology"
      width={420}
      height={166}
      priority={priority}
      className={cn("h-auto w-auto", onDark ? "max-h-9" : "max-h-10", className)}
    />
  );
  return onDark ? <span className="inline-flex rounded-lg bg-white px-2.5 py-1.5 shadow-sm">{img}</span> : img;
}
