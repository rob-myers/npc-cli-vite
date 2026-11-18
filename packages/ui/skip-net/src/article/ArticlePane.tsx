import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, Spinner } from "@npc-cli/util";
import { Suspense, useContext, useMemo, useRef, useState } from "react";
import { articleKeyOf, getArticle } from "../articles";
import { SkipNetContext } from "../context";
import { SessionPicker } from "../SessionPicker";
import type { SkipNetWindow } from "../schema";
import { useSessionRunner } from "../use-session-runner";
import { useWindowSession } from "../use-window-session";
import { articleComponents } from "./components";
import { ArticleContext, type ArticleCtxt } from "./context";
import { FitHeight } from "./FitHeight";

/** An article, its commands run in the window's session */
export function ArticlePane({ win }: { win: SkipNetWindow }) {
  const state = useContext(SkipNetContext);
  const { theme } = useContext(UiContext);
  const session = useWindowSession(win, state.meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);
  const [ranId, setRanId] = useState<null | string>(null);
  const articleRef = useRef<HTMLElement>(null);

  const articleKey = articleKeyOf(win.articleKey);
  const Content = articleKey === undefined ? undefined : getArticle(articleKey);

  /** Fences update through the context alone, so a run never re-renders the whole article */
  const content = useMemo(() => Content && <Content components={articleComponents} />, [Content]);
  const ctxt = useMemo(
    (): ArticleCtxt => ({
      articleKey: articleKey ?? "",
      copiedSrc: runner.copiedSrc,
      ranId,
      copy: runner.copySrc,
      run(exampleId, src) {
        setRanId(exampleId);
        runner.runSrc(src);
      },
    }),
    [articleKey, runner.copiedSrc, ranId],
  );

  if (articleKey === undefined || content === undefined) {
    return <div className="p-2 text-mac-muted">No articles in packages/ui/skip-net/src/articles</div>;
  }

  return (
    <div className="size-full flex flex-col bg-mac-window text-mac-text">
      <SessionPicker runner={runner} session={session} win={win} />
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin px-3 pt-4 pb-3">
        <ArticleContext.Provider value={ctxt}>
          <Suspense fallback={<Spinner className="size-4 m-2" />}>
            <article
              ref={articleRef}
              className={cn("prose prose-sm max-w-[unset] leading-[1.4]", theme === "dark" && "prose-invert")}
            >
              {content}
            </article>
            {win.fit && <FitHeight key={articleKey} articleRef={articleRef} win={win} />}
          </Suspense>
        </ArticleContext.Provider>
      </div>
    </div>
  );
}
