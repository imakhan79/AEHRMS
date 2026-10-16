"use client";

import { motion } from "framer-motion";
import { EASE_OUT } from "@/components/motion";

/** Route transition for every in-app page: quick fade + rise (re-mounts on navigation). */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
      {children}
    </motion.div>
  );
}
