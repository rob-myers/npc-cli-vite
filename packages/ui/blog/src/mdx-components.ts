import type { MdxComponents } from "./pages";
import Video from "./Video";

/** In scope inside every `./pages/*.mdx`, via MDX's `components` prop */
export const mdxComponents: MdxComponents = {
  Video,
};
