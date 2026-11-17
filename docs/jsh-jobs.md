# Jsh jobs

A tty's process leaders, shown in a panel beside it (`packages/ui/jsh/src/Jobs.tsx`). It replaced the `Jobs` ui and SkipNet's jobs window.

- **Toggle.** **jobs** at the tty's top right shows or hides it. It sits above the tty's menu, whose trigger never goes higher than `minY` (40px), so it stays put as the trigger is dragged.
- **Saved** per tty as `meta.jobs`: `shown`, `at` (`top`, `bottom`, `left` or `right`) and `size`, its share of the Jsh along `at`'s axis.
- **Moving.** It has no header: a semi-transparent grip button at its top right drags it. Dragged near an edge's centre, the rect it would take there shows (`DropRect`, `sideAt`), and letting go moves it there. Elsewhere, letting go does nothing. Escape cancels.
- **Resizing.** The sash between them, the jobs at least 96px and the tty 160px.
- **The tty never remounts**, which would reboot its session. It stays first in the DOM, and a reversed flex direction puts the jobs before it.
- **Its session.** Jobs reads the tty's own session, reconnecting when it reboots (`meta.sessionBootedAt`). Hidden, it is unmounted, and rebuilt from the session's process leaders when shown.
