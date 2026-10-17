"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Shared motion tokens: short, decelerating entrances; transform/opacity only.
 * reducedMotion="user" disables movement for people who ask for reduced motion.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.28, ease: EASE_OUT }}>
      {children}
    </MotionConfig>
  );
}

export function FadeIn({ children, delay = 0, y = 12, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } },
};

/** Staggers its direct StaggerItem children (cards, list rows) on mount. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={container} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}

/** Reveal when scrolled into view (landing page sections). */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/** KPI tile: fades up on mount, lifts slightly on hover. */
export function StatCard({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="relative h-full overflow-hidden rounded-2xl border border-gray-200/80 bg-gradient-to-br from-white via-white to-indigo-50/50 p-5 shadow-[0_1px_2px_rgba(28,25,23,0.04)] before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-gradient-to-r before:from-indigo-700 before:via-indigo-500 before:to-brand-amber before:opacity-70"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, boxShadow: "0 14px 32px -12px rgba(115,32,27,0.22)" }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Subtle lift for interactive cards (scale stays within 1.0–1.02). */
export function HoverLift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -2 }} whileTap={{ scale: 0.99 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
      {children}
    </motion.div>
  );
}
