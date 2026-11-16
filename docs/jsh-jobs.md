# Jsh jobs

A tty's process leaders, shown in a panel beside it (`packages/ui/jsh/src/Jobs.tsx`). It replaced the `Jobs` ui and SkipNet's jobs window.

- **Toggle.** **jobs** beside the tab's dots shows or hides it (`JobsToggle`). A ui adds a control there as `TabButton` on its definition.
- **Saved** per tty as `meta.jobs`: `shown`, `at` (`top`, `bottom`, `left` or `right`) and `size`, its share of the Jsh along `at`'s axis.
- **Moving.** Its header is a grip, marked by a dots icon. Dragged near an edge's centre, the rect it would take there shows (`DropRect`, `sideAt`), and letting go moves it there. Elsewhere, letting go does nothing. Escape cancels.
- **Resizing.** The sash between them, the jobs at least 96px and the tty 160px.
- **The tty never remounts**, which would reboot its session. It stays first in the DOM, and a reversed flex direction puts the jobs before it.
- **Its session.** Jobs reads the tty's own session, reconnecting when it reboots (`meta.sessionBootedAt`). Hidden, it is unmounted, and rebuilt from the session's process leaders when shown.
