import { createFileRoute } from "@tanstack/react-router";
import { Responsive as ResponsiveReactGridLayout, useContainerWidth } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@npc-cli/util";
import TestMdx from "../blog/test-mdx.mdx";
import { themeApi, useThemeName } from "../stores/theme.store";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { width, containerRef, mounted } = useContainerWidth();
  const theme = useThemeName();

  return (
    <div ref={containerRef} className="w-full">
      {mounted && (
        <ResponsiveReactGridLayout
          className="border text-on-background [&_.react-resizable-handle::after]:border-on-background!"
          // gridConfig={{ cols: 12, rowHeight: 50 }}
          breakpoints={breakpoints}
          layouts={layouts}
          cols={cols}
          width={width}
        >
          {["a", "b", "c"].map((key) => (
            <div key={key} className="border flex items-center justify-center">
              {key}
            </div>
          ))}
          <div
            key="d"
            className={cn(
              theme === "dark" && "prose-invert",
              "prose prose-sm overflow-auto border p-4",
            )}
          >
            <TestMdx />
          </div>
          <div key="e" className="border p-4 flex items-center">
            <button type="button" className="cursor-pointer" onClick={themeApi.setOther}>
              {theme}
            </button>
          </div>
        </ResponsiveReactGridLayout>
      )}
    </div>
  );
}

const layouts = {
  lg: [
    { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
    { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
    { i: "c", x: 4, y: 0, w: 1, h: 2 },
    { i: "d", x: 0, y: 1, w: 4, h: 4 },
  ],
};
const breakpoints = { lg: 1200, sm: 768 };
const cols = { lg: 12, sm: 6 };
