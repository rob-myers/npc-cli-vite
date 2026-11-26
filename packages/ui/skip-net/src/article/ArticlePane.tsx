import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner, tw, useStateRef } from "@npc-cli/util";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { type MouseEvent, Suspense, useContext, useMemo } from "react";
import { articleFolderOf, articleKeyOf, getArticle } from "../articles";
import { SkipNetContext } from "../context";
import { FitWindow } from "../desktop/FitWindow";
import { articleRows } from "../desktop/windows";
import { SessionPicker } from "../SessionPicker";
import type { SkipNetWindow } from "../schema";
import { useSessionRunner } from "../use-session-runner";
import { useWindowSession } from "../use-window-session";
import { articleComponents } from "./components";
import { ArticleContext, type ArticleCtxt } from "./context";

/** An article, its commands run in the window's session */
export function ArticlePane({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const { theme } = useContext(UiContext);
  const session = useWindowSession(win, state.meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);
  const pane = useStateRef(
    (): PaneState => ({
      articleRef: { current: null },
      backTop: null,
      ranId: null,
      scrollerEl: null,

      forgetBack() {
        pane.backTop !== null && pane.set({ backTop: null });
      },
      goBack() {
        pane.scrollerEl?.scrollTo({ top: pane.backTop ?? 0, behavior: "smooth" });
        pane.set({ backTop: null });
      },
      onArticleClick(e) {
        const from = pane.scrollerEl?.scrollTop ?? null;
        scrollToHash(e) && pane.set({ backTop: from });
      },
      run(exampleId, src) {
        pane.set({ ranId: exampleId });
        runner.runSrc(src);
      },
    }),
  );

  const articleKey = articleKeyOf(win.articleKey);
  const Content = articleKey === undefined ? undefined : getArticle(articleKey);

  /** Fences update through the context alone, so a run never re-renders the whole article */
  const content = useMemo(() => Content && <Content components={articleComponents} />, [Content]);
  const ctxt = useMemo(
    (): ArticleCtxt => ({
      articleKey: articleKey ?? "",
      copiedSrc: runner.copiedSrc,
      ranId: pane.ranId,
      sessionKey: session.ttyMeta?.sessionKey ?? null,
      worldKey: state.meta.worldKey,
      copy: runner.copySrc,
      run: pane.run,
    }),
    [articleKey, runner.copiedSrc, pane.ranId, session.ttyMeta?.sessionKey, state.meta.worldKey],
  );

  if (articleKey === undefined || content === undefined) {
    return <div className="p-2 text-mac-muted">No articles in packages/ui/skip-net/src/articles</div>;
  }

  return (
    <div className="size-full flex flex-col bg-mac-window text-mac-text">
      <SessionPicker runner={runner} session={session} win={win} />
      <div
        ref={pane.ref("scrollerEl")}
        // scrolled by hand, its back pill is forgotten
        onWheel={pane.forgetBack}
        onTouchStart={pane.forgetBack}
        className="relative flex-1 min-h-0 overflow-auto scrollbar-thin px-3 pt-4 pb-3"
      >
        {pane.backTop !== null && (
          // sticks to its top, taking no room, so it goes without shifting the scroll
          <div className="sticky top-0 z-10 h-0">
            <button type="button" className={backPillClass} onClick={pane.goBack}>
              <ArrowLeftIcon weight="bold" className="size-3" />
              back
            </button>
          </div>
        )}
        <ArticleContext.Provider value={ctxt}>
          <Suspense
            fallback={
              <div className="absolute inset-0 grid place-items-center">
                <Spinner className="size-6" />
              </div>
            }
          >
            <article
              ref={pane.articleRef}
              onClick={pane.onArticleClick}
              className={cn(
                "prose prose-sm max-w-[unset] leading-[1.4] prose-code:before:hidden prose-code:after:hidden prose-code:px-1 prose-code:bg-mac-text/10",
                theme === "dark" && "prose-invert",
                articleFolderOf(articleKey) !== "video" && framedClass,
              )}
            >
              {content}
            </article>
            {win.fit && <FitWindow key={articleKey} contentRef={pane.articleRef} win={win} maxRows={articleRows} />}
          </Suspense>
        </ArticleContext.Provider>
      </div>
    </div>
  );
}

type PaneState = {
  /** Its article, which `FitWindow` measures */
  articleRef: { current: null | HTMLElement };
  /** Where it was scrolled before a link's jump, which its back pill returns to */
  backTop: null | number;
  /** The command last run, which keeps its border */
  ranId: null | string;
  scrollerEl: null | HTMLDivElement;
  /** Scrolled by hand, its back pill goes */
  forgetBack(): void;
  goBack(): void;
  onArticleClick(e: MouseEvent<HTMLElement>): void;
  run(exampleId: string, src: string): void;
};

/** A link to `#id` in an article scrolls to that id in it alone, leaving the page's url be. Did it? */
function scrollToHash(e: MouseEvent<HTMLElement>) {
  const href = (e.target as Element).closest("a")?.getAttribute("href");
  if (href?.startsWith("#") !== true) return false;
  e.preventDefault();
  const el = e.currentTarget.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  return el !== null;
}

/** At the top-right of its view after a link's jump, returning to where it was */
const backPillClass = tw(
  "absolute -right-1 -top-2 flex items-center gap-1 rounded-full border border-mac-edge bg-mac-select px-2.5 py-1 font-mono text-xs font-bold text-mac-on-select shadow-[1px_1px_0_var(--color-mac-shadow)] cursor-pointer hover:opacity-85",
);

/** Its session picker alone, in a folded article window's bar */
export function ArticleSessionPicker({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const session = useWindowSession(win, state.meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);
  return <SessionPicker runner={runner} session={session} win={win} />;
}

/** A rounded frame around each of an article's files, though not its videos */
const framedClass = tw(
  "flex flex-col gap-3 *:rounded-xl *:border *:border-mac-text/20 *:px-4 *:py-3 [&>section>:first-child]:mt-0 [&>section>:last-child]:mb-0",
);
