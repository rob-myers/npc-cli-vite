import { useEffect, useRef, useState } from "react";

/** True once the returned ref has come within `rootMargin` of the viewport */
export function useNearViewport(rootMargin = "200px") {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    // `root: null` still works inside a scrolling pane: clipping ancestors are intersected in
    const observer = new IntersectionObserver((xs) => void (xs.some((x) => x.isIntersecting) && setNear(true)), {
      rootMargin,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, rootMargin]);

  return { ref, near };
}
