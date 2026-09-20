import Giscus from "@giscus/react";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { useContext } from "react";
import { giscusConfig } from "./giscus.config";

/**
 * One discussion per page: the blog has no url of its own, so `term` names the thread.
 * Loads eagerly because the write box sits below the fold; the pane gate holds it back instead.
 */
export default function BlogComments({ pageKey }: { pageKey: string }) {
  const { theme } = useContext(UiContext);
  return (
    <Giscus
      id={`giscus-${pageKey}`}
      repo={giscusConfig.repo}
      repoId={giscusConfig.repoId}
      category={giscusConfig.category}
      categoryId={giscusConfig.categoryId}
      mapping="specific"
      term={`blog/${pageKey}`}
      strict="1"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="top"
      // transparent lets the pane background through: no preset matches `--color-background`
      theme={theme === "dark" ? "transparent_dark" : "light"}
      lang="en"
      loading="eager"
    />
  );
}
