import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
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
      <div className="flex flex-col size-full bg-black text-white">
        <h2 className="shrink-0 px-4 py-3 border-b text-white border-on-background/25 bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-size-[10px_10px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-white)_20%,transparent)]">
          Error in <span className="font-mono">{this.props.meta?.uiKey}</span>
        </h2>

        <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-5 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm/relaxed text-red-400 tracking-wide">
            {this.state.error.message}
          </pre>

          <section className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h3 className={labelCss}>stack</h3>
              <button
                type="button"
                title="copy stack"
                className="cursor-pointer text-white/60 transition-colors hover:text-white"
                onClick={this.copyStack}
              >
                {this.state.copied ? (
                  <CheckIcon alt="copied" className="size-4 text-green-500" />
                ) : (
                  <CopyIcon alt="copy stack" className="size-4" />
                )}
              </button>
            </div>
            {/* drag the bottom-right corner to resize */}
            <pre className={cn(boxCss, "h-56 min-h-16 resize-y font-sans text-sm/relaxed text-green-600")}>
              {this.state.error.stack}
            </pre>
          </section>

          <section className="flex flex-col gap-1.5">
            <h3 className={labelCss}>ui meta</h3>
            <pre className={cn(boxCss, "h-40 min-h-16 resize-y font-mono text-xs/relaxed text-amber-200")}>
              {safeJsonCompact(this.props.meta)}
            </pre>
          </section>
        </div>

        <div className="shrink-0 p-4 border-t border-white/15">
          <button
            type="button"
            className="cursor-pointer px-3 py-1.5 font-sans text-sm text-white bg-black border border-white/50 rounded transition-colors hover:bg-white/10"
            onClick={() => this.setState({ error: NoErrorSymbol })}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }
}

const labelCss = "text-xs uppercase tracking-widest text-white/40";
/** A scrollable bordered block, shared by the stack and the ui meta */
const boxCss = cn(
  "overflow-auto [scrollbar-width:thin] whitespace-pre-wrap tracking-wide",
  "p-3 rounded border border-white/25 bg-white/3",
);

const NoErrorSymbol = Symbol();

/** How long a copied stack is indicated */
const copiedMs = 1000;

type BaseProps = { meta: UiInstanceMeta };
