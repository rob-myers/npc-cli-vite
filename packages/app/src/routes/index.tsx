import { createFileRoute } from "@tanstack/react-router";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import TestMdx from "../blog/test-mdx.mdx";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { width, containerRef, mounted } = useContainerWidth();

  return (
    <div ref={containerRef} className="w-full">
      {mounted && (
        <ReactGridLayout
          className="border"
          gridConfig={{ cols: 12, rowHeight: 50 }}
          layout={layout}
          width={width}
        >
          {["a", "b", "c"].map((key) => (
            <div key={key} className="border flex items-center justify-center">
              {key}
            </div>
          ))}
          <div key="d" className="prose prose-sm overflow-auto border p-4">
            <TestMdx />
          </div>
        </ReactGridLayout>
      )}
    </div>
  );
}

const layout = [
  { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
  { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
  { i: "c", x: 4, y: 0, w: 1, h: 2 },
  { i: "d", x: 0, y: 1, w: 4, h: 4 },
];
