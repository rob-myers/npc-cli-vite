import { createContext } from "react";

/** What an article's components share with its pane */
export type ArticleCtxt = {
  articleKey: string;
  /** Most recently copied `src`, briefly indicated */
  copiedSrc: null | string;
  /** The command last run, which keeps its border */
  ranId: null | string;
  copy(src: string): void;
  run(exampleId: string, src: string): void;
};

export const ArticleContext = createContext<ArticleCtxt>(null as never);
