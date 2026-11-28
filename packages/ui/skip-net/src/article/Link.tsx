import type { AnchorHTMLAttributes } from "react";

/** An article's link: one leaving the article opens in a new tab, a `#id` scrolls within it */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const away = props.href !== undefined && props.href.startsWith("#") === false;
  return <a {...props} {...(away && { target: "_blank", rel: "noopener noreferrer" })} />;
}
