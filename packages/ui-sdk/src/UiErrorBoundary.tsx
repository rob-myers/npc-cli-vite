import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { jsStringify } from "@npc-cli/util/legacy/generic";
import { Component } from "react";
import { uiClassName } from "./const";

export class UiErrorBoundary extends Component<
  React.PropsWithChildren<BaseProps>,
  { error: Error | typeof NoErrorSymbol }
> {
  constructor(props: React.PropsWithChildren<BaseProps>) {
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
          UI Error: <span className="text-amber-200">{this.props.meta?.uiKey}</span>
        </h2>
        <div className="overflow-auto">
          <pre className="px-4 py-2 whitespace-pre-wrap font-sans text-sm text-red-400 leading-relaxed tracking-wide">
            {this.state.error.message}
          </pre>
          <pre className="px-4 py-2 whitespace-pre-wrap font-mono text-xs text-amber-200 leading-relaxed tracking-wide">
            {jsStringify(this.props.meta)}
          </pre>
        </div>
        <button
          type="button"
          className={cn(
            uiClassName,
            "cursor-pointer p-2 m-4 self-start font-sans text-sm text-black bg-white border rounded",
          )}
          onClick={() => this.setState({ error: NoErrorSymbol })}
        >
          Refresh
        </button>
      </div>
    );
  }
}

const NoErrorSymbol = Symbol();

type BaseProps = { meta: UiInstanceMeta };
