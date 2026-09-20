import { cn } from "@npc-cli/util";
import LiteYouTubeEmbed from "react-lite-youtube-embed";
import "react-lite-youtube-embed/dist/LiteYouTubeEmbed.css";

/** Click-to-load YouTube facade, for use inside mdx pages */
export default function Video({ id, title, className }: { id: string; title?: string; className?: string }) {
  return (
    // `not-prose` else typography restyles the embed's internals
    <div className={cn("not-prose my-6 overflow-hidden rounded border border-on-background/20", className)}>
      <LiteYouTubeEmbed id={id} title={title ?? "YouTube video"} poster="hqdefault" webp />
    </div>
  );
}
