import { cn } from "@npc-cli/util";
import LiteYouTubeEmbed from "react-lite-youtube-embed";
import "react-lite-youtube-embed/dist/LiteYouTubeEmbed.css";

/** A YouTube video, loaded on click, for use inside articles */
export default function Video({ id, title, className }: { id: string; title?: string; className?: string }) {
  return (
    // `not-prose` else typography restyles the embed's internals
    <div className={cn("not-prose my-4 first:mt-0 last:mb-0 overflow-hidden border border-mac-edge", className)}>
      <LiteYouTubeEmbed id={id} title={title ?? "YouTube video"} poster="hqdefault" webp />
    </div>
  );
}
