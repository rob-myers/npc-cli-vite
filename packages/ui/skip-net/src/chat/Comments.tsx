import Giscus from "@giscus/react";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { useContext } from "react";
import { giscusConfig } from "./giscus.config";

/** A giscus thread, named by `term` as SkipNet has no url of its own. Lazy, so giscus is a chunk of its own */
export default function Comments({ threadKey }: { threadKey: string }) {
  const { theme } = useContext(UiContext);
  return (
    <Giscus
      id={`giscus-${threadKey}`}
      repo={giscusConfig.repo}
      repoId={giscusConfig.repoId}
      category={giscusConfig.category}
      categoryId={giscusConfig.categoryId}
      mapping="specific"
      term={`skipnet/${threadKey}`}
      strict="1"
      reactionsEnabled="1"
      emitMetadata="0"
      inputPosition="top"
      // transparent lets the window's grey through
      theme={theme === "dark" ? "transparent_dark" : "light"}
      lang="en"
      loading="eager"
    />
  );
}
