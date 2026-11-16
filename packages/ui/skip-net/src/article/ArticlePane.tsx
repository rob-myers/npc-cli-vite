import { Spinner } from "@npc-cli/util";
import { Picker } from "@npc-cli/util/picker";
import { Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { articleKeys, getArticle } from "../articles";
import { SkipNetContext } from "../context";
import { useSessionRunner } from "../library/use-session-runner";
import { SessionBar } from "../SessionBar";
import type { SkipNetLeaf } from "../schema";
import { usePaneSession } from "../use-pane-session";
import { articleComponents } from "./components";
import { ArticleContext, type ArticleCtxt } from "./context";

/** An article, its commands run in the pane's session */
export function ArticlePane({ leaf, paneId }: { leaf: SkipNetLeaf; paneId: number }) {
  const state = useContext(SkipNetContext);
  const session = usePaneSession(leaf, state.meta.worldKey);
  const runner = useSessionRunner(session.ttyMeta);
  const [ranId, setRanId] = useState<null | string>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /** A stale key falls back to the first */
  const articleKey = articleKeys.find((x) => x === leaf.articleKey) ?? articleKeys[0];
  const Content = articleKey === undefined ? undefined : getArticle(articleKey);
  useEffect(() => void bodyRef.current?.scrollTo({ top: 0 }), [articleKey]);

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
    return <div className="p-2 text-term-muted">No articles in packages/ui/skip-net/src/articles</div>;
  }

  return (
    <div className="size-full flex flex-col bg-term-dashboard text-term-foreground">
      <SessionBar leaf={leaf} paneId={paneId} runner={runner} session={session}>
        <Picker
          value={articleKey}
          options={articleKeys}
          onChange={(articleKey) => state.setLeaf(paneId, { ...leaf, articleKey })}
          title="the article shown"
          popupClassName="skip-net"
        />
      </SessionBar>
      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto scrollbar-thin px-3 pt-4 pb-3">
        <ArticleContext.Provider value={ctxt}>
          <Suspense fallback={<Spinner className="size-4 m-2" />}>
            <article key={articleKey} className="prose prose-sm prose-invert max-w-[unset] leading-[1.4]">
              {content}
            </article>
          </Suspense>
        </ArticleContext.Provider>
      </div>
    </div>
  );
}
