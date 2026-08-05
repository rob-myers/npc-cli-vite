import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { error as logError, safeJsonCompact } from "@npc-cli/util/legacy/generic";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Component } from "react";

export class UiErrorBoundary extends Component<
  React.PropsWithChildren<BaseProps>,
  { error: Error | typeof NoErrorSymbol; copied: boolean }
> {
  copiedTimeoutId = 0;

  constructor(props: React.PropsWithChildren<BaseProps>) {
    super(props);
    this.state = { error: NoErrorSymbol, copied: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { error: error instanceof Error ? error : new Error(JSON.stringify(error)) };
  }

  override componentWillUnmount() {
    window.clearTimeout(this.copiedTimeoutId);
  }

  copyStack = () => {
    if (this.state.error === NoErrorSymbol) {
      return;
    }
    // the stack begins with the message, so it stands alone
    navigator.clipboard
      .writeText(this.state.error.stack ?? this.state.error.message)
      .then(() => {
        window.clearTimeout(this.copiedTimeoutId);
        this.setState({ copied: true });
        this.copiedTimeoutId = window.setTimeout(() => this.setState({ copied: false }), copiedMs);
      })
      .catch(logError);
  };

  override render() {
    if (this.state.error === NoErrorSymbol) {
      return this.props.children;
    }
    return (
      <div className="flex flex-col gap-1 text-white size-full bg-black">
        <h2 className="p-4 border-b text-white border-on-background/25 bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-[size:10px_10px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-white)_20%,transparent)]">
          Error in <span className="font-mono">{this.props.meta?.uiKey}</span>
        </h2>
        <div className="overflow-auto">
          <pre className="px-4 py-2 whitespace-pre-wrap font-sans text-sm text-red-400 leading-relaxed tracking-wide">
            {this.state.error.message}
          </pre>
          <div className="relative px-4 py-2">
            <pre className="max-h-20 overflow-auto border border-white/50 p-2 pr-10 whitespace-pre-wrap font-sans text-green-600 text-sm leading-relaxed tracking-wide">
              {this.state.error.stack}
            </pre>
            <button
              type="button"
              title="copy stack"
              className="absolute right-6 top-4 cursor-pointer text-white/60 transition-colors hover:text-white"
              onClick={this.copyStack}
            >
              {this.state.copied ? (
                <CheckIcon alt="copied" className="size-4 text-green-500" />
              ) : (
                <CopyIcon alt="copy stack" className="size-4" />
              )}
            </button>
          </div>
          <div className="px-4 py-2 flex flex-col gap-1">
            <div className="text-sm">ui meta</div>
            <pre className="whitespace-pre-wrap font-mono text-xs text-amber-200 leading-relaxed tracking-wide">
              {safeJsonCompact(this.props.meta)}
            </pre>
          </div>
        </div>
        <button
          type="button"
          className="cursor-pointer p-2 m-4 self-start font-sans text-sm text-white bg-black border rounded"
          onClick={() => this.setState({ error: NoErrorSymbol })}
        >
          Refresh
        </button>
      </div>
    );
  }
}

const NoErrorSymbol = Symbol();

/** How long a copied stack is indicated */
const copiedMs = 1000;

type BaseProps = { meta: UiInstanceMeta };
