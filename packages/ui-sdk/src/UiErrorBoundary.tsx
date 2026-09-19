import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { error as logError, safeJsonCompact } from "@npc-cli/util/legacy/generic";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Component } from "react";

export class UiErrorBoundary extends Component<
  React.PropsWithChildren<BaseProps>,
  { error: Error | typeof NoErrorSymbol; copied: boolean; showDetails: boolean }
> {
  copiedTimeoutId = 0;

  constructor(props: React.PropsWithChildren<BaseProps>) {
    super(props);
    this.state = { error: NoErrorSymbol, copied: false, showDetails: false };
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
    const uiKey = this.props.meta?.uiKey;
    // a module that never arrived cannot be remounted back into existence
    const canRefresh = chunkLoadFailureRegex.test(this.state.error.message) === false;
    // what broke is the developer's business — in prod it waits behind "Technical details"
    const detailed = import.meta.env.DEV || this.state.showDetails;

    return (
      <div className="flex flex-col size-full bg-black text-white">
        {detailed ? (
          <>
            <h2 className="shrink-0 px-4 py-3 border-b text-white border-on-background/25 bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-size-[10px_10px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-white)_20%,transparent)]">
              Error in <span className="font-mono">{uiKey}</span>
            </h2>

            <div className={cn("flex-1 min-h-0 overflow-auto flex flex-col gap-5 p-4", thinScrollbarCss)}>
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
                {/* a few lines by default — drag the bottom-right corner for more */}
                <pre className={cn(boxCss, "h-28 min-h-12 resize-y font-sans text-sm/relaxed text-white/70")}>
                  {this.state.error.stack}
                </pre>
              </section>

              <section className="flex flex-col gap-1.5">
                <h3 className={labelCss}>ui meta</h3>
                <pre className={cn(boxCss, "h-28 min-h-12 resize-y font-mono text-xs/relaxed text-amber-200")}>
                  {safeJsonCompact(this.props.meta)}
                </pre>
              </section>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 grid place-items-center p-4 text-sm/relaxed text-white/70">
            Something went wrong.
          </div>
        )}

        <div className="shrink-0 flex items-center gap-2 p-4 border-t border-white/15">
          {import.meta.env.PROD && (
            <button
              type="button"
              className={cn(buttonCss, "border-transparent text-white/60 hover:text-white")}
              onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
            >
              Technical details
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {import.meta.env.DEV && (
              <button
                type="button"
                disabled={canRefresh === false}
                title={canRefresh ? undefined : "this module never loaded — reload the page instead"}
                className={cn(
                  buttonCss,
                  canRefresh === false && "cursor-not-allowed text-white/30 border-white/20 hover:bg-black",
                )}
                onClick={() => this.setState({ error: NoErrorSymbol })}
              >
                Refresh {uiKey}
              </button>
            )}
            {(import.meta.env.PROD || canRefresh === false) && (
              <button
                type="button"
                className={cn(buttonCss, "font-medium text-black bg-white border-white hover:bg-white/85")}
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

const labelCss = "text-xs uppercase tracking-widest text-white/40";
const buttonCss =
  "cursor-pointer px-3 py-1.5 font-sans text-sm text-white bg-black border border-white/50 rounded transition-colors hover:bg-white/10";
/** Firefox honours `scrollbar-width`, the rest need the pseudo-elements */
const thinScrollbarCss = cn(
  "[scrollbar-width:thin]",
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25",
);
/** A scrollable bordered block, shared by the stack and the ui meta */
const boxCss = cn(
  "overflow-auto whitespace-pre-wrap tracking-wide",
  "p-3 rounded border border-white/25 bg-white/3",
  thinScrollbarCss,
);

/**
 * A dynamic import that never arrived, as Chrome, Firefox and Safari each word it. React caches
 * the rejection on the `lazy`, so re-rendering rethrows it — only a reload can recover one
 */
const chunkLoadFailureRegex =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i;

const NoErrorSymbol = Symbol();

/** How long a copied stack is indicated */
const copiedMs = 1000;

type BaseProps = { meta: UiInstanceMeta };
