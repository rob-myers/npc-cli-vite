import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { jsStringify } from "@npc-cli/util/legacy/generic";
import { Component } from "react";

export class UiErrorBoundary extends Component<
  React.PropsWithChildren<{ meta: UiInstanceMeta }>,
  { error: Error | typeof NoErrorSymbol }
> {
  constructor(props: React.PropsWithChildren<{ meta: UiInstanceMeta }>) {
    super(props);
    this.state = { error: NoErrorSymbol };
  }

  static getDerivedStateFromError(error: Error) {
    return { error: error instanceof Error ? error : new Error(JSON.stringify(error)) };
  }

  override render() {
    if (this.state.error === NoErrorSymbol) {
      return this.props.children;
    }
    return (
      <div className="flex flex-col gap-1 text-on-background size-full bg-black">
        <h2 className="p-4 border-b text-white border-on-background/25 bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-[size:10px_10px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-white)_20%,transparent)]">
          UI Error ({this.props.meta?.uiKey})
        </h2>
        <div className="overflow-auto">
          <pre className="px-4 py-2 whitespace-pre-wrap font-sans text-sm text-orange-600 leading-relaxed tracking-wide">
            {this.state.error.message}
          </pre>
          <pre className="px-4 py-2 whitespace-pre-wrap font-mono text-xs text-amber-200 leading-relaxed tracking-wide">
            {jsStringify(this.props.meta)}
          </pre>
        </div>
      </div>
    );
  }
}

const NoErrorSymbol = Symbol();
