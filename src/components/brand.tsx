import Image from "next/image";
import { cn } from "@/components/ui";

/**
 * iTANZ logo. The source artwork has a white background, so on dark
 * surfaces it sits on a white tile to keep the teal/yellow legible.
 */
export function BrandLogo({ className, onDark = false, priority = false }: { className?: string; onDark?: boolean; priority?: boolean }) {
  const img = (
    <Image
      src="/itanz-logo.jpeg"
      alt="iTANZ"
      width={400}
      height={142}
      priority={priority}
      className={cn("h-auto w-auto", onDark ? "max-h-9" : "max-h-10", className)}
    />
  );
  return onDark ? <span className="inline-flex rounded-lg bg-white px-2.5 py-1.5 shadow-sm">{img}</span> : img;
}
