import { createFileRoute } from "@tanstack/react-router";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import "allotment/dist/style.css";
import { motion } from "motion/react";
import { useStore } from "zustand";
import { PaneTree } from "./PaneTree";
import { initNextId } from "./pane-service";

export const Route = createFileRoute("/allotment/")({
  component: AllotmentDemo,
});

function AllotmentDemo() {
  const ready = useStore(uiStore, (s) => s.ready);
  const root = useStore(uiStore, (s) => s.persistedPanes);
  initNextId(root);

  return (
    <div className="flex flex-col h-screen bg-slate-950">
      <div className="p-2 text-slate-500 text-xs">
        Split any pane horizontally or vertically. Close panes with ✕.
      </div>
      <motion.div
        className="flex-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        {ready && <PaneTree node={root} />}
      </motion.div>
    </div>
  );
}
