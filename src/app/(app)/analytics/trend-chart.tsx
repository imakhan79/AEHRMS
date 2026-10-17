"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { EASE_OUT } from "@/components/motion";
import type { Trend } from "@/lib/analytics";

/**
 * Single-series bar chart: one brand hue (no legend needed), bars anchored to the baseline with
 * rounded data ends, 2px gaps, recessive axis, the latest value direct-labelled, and a hover/focus
 * tooltip on every bar. The table below each chart is the accessible data view.
 */
export function TrendChart({ trend }: { trend: Trend }) {
  const max = Math.max(...trend.points.map((p) => p.value), 0);
  const last = trend.points.at(-1);
  if (!trend.points.length) return null;
  return (
    <figure>
      <figcaption className="mb-3 flex items-baseline justify-between gap-4">
        <span className="text-sm font-semibold text-gray-900">{trend.title}</span>
        {last && <span className="text-xs text-gray-500">Latest: {last.display}</span>}
      </figcaption>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-gray-100" aria-hidden="true" />
        <div className="pointer-events-none absolute right-0 -top-2 bg-white pl-1 text-[10px] tabular-nums text-gray-400" aria-hidden="true">
          {Math.round(max).toLocaleString("en-PK")}
        </div>
        <ul className="flex h-40 items-end gap-0.5 border-b border-gray-200" aria-label={trend.title}>
          {trend.points.map((p, i) => {
            const h = max > 0 ? Math.max((p.value / max) * 100, p.value > 0 ? 2 : 0) : 0;
            const bar = (
              <motion.span
                className={`block w-full origin-bottom rounded-t-[4px] transition-colors ${i === trend.points.length - 1 ? "bg-indigo-600" : "bg-indigo-400 group-hover:bg-indigo-600"}`}
                style={{ height: `${h}%` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 + i * 0.025 }}
              />
            );
            return (
              <li key={`${p.label}-${i}`} className="group relative flex h-full flex-1 items-end">
                {p.href ? (
                  <Link href={p.href} className="flex h-full w-full items-end outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label={p.display}>
                    {bar}
                  </Link>
                ) : (
                  <span className="flex h-full w-full items-end" tabIndex={0} aria-label={p.display}>
                    {bar}
                  </span>
                )}
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow group-focus-within:block group-hover:block"
                >
                  {p.display}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-1 flex gap-0.5" aria-hidden="true">
          {trend.points.map((p, i) => (
            <span key={`${p.label}-${i}`} className="flex-1 truncate text-center text-[10px] text-gray-500">
              {trend.points.length > 16 && i % 3 !== 0 && i !== trend.points.length - 1 ? "" : p.label}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
