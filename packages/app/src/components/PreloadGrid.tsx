import { motion } from "motion/react";
import { useStore } from "zustand/react";
import { layoutStore } from "./layout.store";

/**
 * Improve initial rendering by showing a skeleton of the grid layout
 */
export const PreloadGrid = () => {
  const { itemToRect, ready } = useStore(layoutStore);

  return (
    <motion.div
      className="fixed pointer-events-none"
      initial={{ opacity: 1 }}
      animate={ready ? { opacity: 0, transition: { duration: 1 } } : undefined}
    >
      {Object.entries(itemToRect).map(([itemId, { x, y, width, height }]) => (
        <div
          key={itemId}
          className="absolute border border-white/30"
          style={{
            width,
            height,
            transform: `translate3d(${x}px, ${y}px, 0)`,
          }}
        ></div>
      ))}
    </motion.div>
  );
};
