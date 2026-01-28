import { useEffectNonStrict, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { error, jsStringify, keys, testNever, warn } from "@npc-cli/util/legacy/generic";
import debounce from "debounce";
import React from "react";
import useMeasure from "react-use-measure";
import { toProcessStatus } from "../shell/const";
// import type { BaseTabProps } from '../tabs/tab-factory';
import type { ExternalMessage, ExternalMessageProcessLeader } from "../shell/io";
import type { Session } from "../shell/session";
import { sessionApi } from "../shell/session";
import { BaseTty, type State as BaseTtyState } from "./BaseTty";
import { TtyMenu } from "./TtyMenu";

/**
 * A `BaseTty` which can be:
 * - paused/resumed
 * - booted with a shell profile (~/PROFILE)
 * - sourced with externally provided shell functions (/etc/*)
 */
export function Tty(props: Props) {
  const [rootRef, bounds] = useMeasure({ debounce: 0, scroll: false });
  const baseRef = React.useRef<BaseTtyState>(null);

  const state = useStateRef(
    () => ({
      /**
       * Have we initiated the profile?
       * We don't want to re-run it on hmr.
       */
      booted: false,
      bounds,
      canContOrStop: null as null | "CONT" | "STOP",
      disabled: props.disabled,
      isTouchDevice: isTouchDevice(),
      /** The process ids we actually paused, so we can resume them  */
      pausedPids: new Set<number>(),
      /** Process group ids spawned whilst paused  */
      pausedSpawnPgids: new Set<number>(),
      /** Should file be auto-re-sourced on hot-module-reload? */
      reSource: {} as Record<string, true>,

      fitDebounced: debounce(() => {
        if (baseRef.current) {
          // 🔔 fix scrollbar sync issue
          baseRef.current.xterm.forceResize();
          baseRef.current.fitAddon.fit();
        }
      }, 300),
      handleExternalMsg({ msg }: ExternalMessage) {
        switch (msg.key) {
          case "auto-re-source-file": {
            const basename = msg.absPath.slice("/etc/".length);
            if (basename in props.shFiles) {
              // 🔔 delete and assign _appends_ the key for non-integer keys
              delete state.reSource[basename];
              state.reSource[basename] = true;
            } else {
              warn(`${"handleExternalMsg"}: basename not found: ${basename}`);
            }
            break;
          }
          case "process-leader": {
            state.handleProcessLeaderMessage(msg);
            break;
          }
          default:
            warn(`${"handleExternalMsg"}: unexpected message: ${jsStringify(msg)}`);
            testNever(msg);
        }
      },
      handleProcessLeaderMessage(msg: ExternalMessageProcessLeader) {
        if (msg.pid === 0) {
          if (msg.act === "started" || msg.act == "resumed") {
            state.canContOrStop = "STOP";
          } else if (msg.act === "paused") {
            state.canContOrStop = "CONT";
          } else if (msg.act === "ended") {
            state.canContOrStop = null;
          }
          state.update();
        } else if (state.disabled === true) {
          if (msg.act === "started") {
            // spawned whilst paused
            state.pausedSpawnPgids.add(msg.pid);
          } else if (msg.act === "paused") {
            // pause whilst paused e.g. keep paused on resume
            state.pausedSpawnPgids.delete(msg.pid);
          } else if (msg.act === "resumed") {
            // 🚧 remove pids ...
            state.pausedSpawnPgids.delete(msg.pid);
            const pids = sessionApi.getProcesses(props.sessionKey, msg.pid).map((p) => p.key);
            pids.forEach((pid) => void state.pausedPids.delete(pid));
          }
        }
      },
      pauseByPtags() {
        if (!baseRef.current) return;
        const pids = sessionApi.kill(props.sessionKey, [], { byPtags: true, STOP: true });
        pids.forEach((pid) => void state.pausedPids.add(pid));

        const { session } = baseRef.current;
        if (session.ttyShell.isInitialized() && !session.ttyShell.isInteractive()) {
          state.canContOrStop =
            session.process[0].status === toProcessStatus.Running ? "STOP" : "CONT";
        } else {
          state.canContOrStop = null;
        }

        state.update();
      },
      reboot() {
        state.booted = false;
        state.update();
      },
      async resize() {
        if (baseRef.current) state.fitDebounced();
      },
      resumeByPtags() {
        if (!baseRef.current) return;
        // restore previously paused processes
        sessionApi.kill(props.sessionKey, Array.from(state.pausedPids), {
          byPtags: true,
          CONT: true,
        });
        state.pausedPids.clear();

        // resume spawned whilst paused, unless explicitly paused
        for (const pgid of state.pausedSpawnPgids) {
          sessionApi.kill(props.sessionKey, [pgid], { GROUP: true, CONT: true });
        }
        state.pausedSpawnPgids.clear();

        const { session } = baseRef.current;
        if (session.ttyShell.isInitialized() && !session.ttyShell.isInteractive()) {
          state.canContOrStop =
            session.process[0].status === toProcessStatus.Running ? "STOP" : "CONT";
        } else {
          state.canContOrStop = null;
        }

        state.update();
      },
      async storeAndSourceFuncs() {
        if (!baseRef.current) return;
        const session = baseRef.current.session;

        Object.assign(session.etc, props.shFiles);

        // Only auto-re-source shell function declaration files
        // that have already been sourced in this session
        // Re-source sequentially to preserve function overriding.
        for (const filename of keys(state.reSource)) {
          try {
            const src = session.etc[filename];
            await session.ttyShell.sourceExternal(src);
          } catch (e: any) {
            if (typeof e?.$type === "string") {
              // mvdan.cc/sh/v3/syntax.ParseError
              const fileContents = props.shFiles[filename];
              const [line, _column] = [e.Pos.Line(), e.Pos.Col()];
              const errorMsg = `${e.Error()}:\n${fileContents.split("\n")[line - 1]}`;
              state.writeErrorToTty(session.key, `/etc/${filename}: ${e.$type}`, errorMsg);
            } else {
              state.writeErrorToTty(session.key, `/etc/${filename}: failed to run`, e);
            }
          }
        }

        // store original functions too
        Object.assign(session.modules, props.modules);
      },
      writeErrorToTty(sessionKey: string, message: string, origError: any) {
        sessionApi.writeMsg(sessionKey, `${message} (see console)`, "error");
        error(message);
        error(origError);
      },
    }),
    {
      deps: [props.shFiles, props.modules],
    },
  );

  state.disabled = props.disabled;

  // Pause/resume
  React.useEffect(() => {
    if (!baseRef.current?.session) return;
    const { session } = baseRef.current;

    // if disabled, suspend spawned bg processes sans process tag 'always'
    session.ttyShell.disabled = !!props.disabled;

    if (props.disabled === true) {
      // avoid initial pause: something was spawned
      session.nextPid > 1 && state.pauseByPtags();
    } else {
      state.resumeByPtags();
    }
  }, [props.disabled, baseRef.current?.session]);

  React.useEffect(() => {
    if (!baseRef.current?.session) return;
    // Bind external events
    const {
      xterm: { xterm },
      session,
    } = baseRef.current;

    xterm.attachCustomKeyEventHandler((e) => {
      // xterm.js should not handle shift/ctrl + enter,
      // so we can unpause Tabs from Tty
      if (e.type === "keyup") {
        props.onKey?.(e); // handle shift/ctrl + enter
      }
      if (e.key === "Enter" && (e.shiftKey === true || e.ctrlKey === true)) {
        return false;
      } else {
        return true;
      }
    });

    state.resize();
    const cleanupExternalMsgs = session.ttyShell.io.handleWriters(
      (msg) => msg?.key === "external" && state.handleExternalMsg(msg),
    );

    return () => {
      cleanupExternalMsgs();
    };
  }, [baseRef.current?.session]);

  React.useEffect(() => {
    const onKeyDispose = baseRef.current?.xterm?.xterm.onKey((e) => props.onKey?.(e.domEvent));
    return () => onKeyDispose?.dispose();
  }, [props.onKey]);

  React.useEffect(() => {
    // Handle resize
    state.bounds = bounds;
    baseRef.current?.session && state.resize();
  }, [bounds]);

  React.useEffect(() => {
    // sync shell functions
    if (baseRef.current?.session?.ttyShell.isInitialized()) {
      state.storeAndSourceFuncs();
    }
  }, [
    baseRef.current?.session,
    ...Object.entries(props.shFiles).flatMap((x) => x),
    ...Object.entries(props.modules).flatMap((x) => x),
  ]);

  React.useEffect(() => {
    // sync ~/PROFILE
    if (baseRef.current?.session) {
      baseRef.current.session.var.PROFILE = props.profile;
    }
  }, [baseRef.current?.session, props.profile]);

  // useEffectNonStrict here so it occurs after BaseTty's
  useEffectNonStrict(() => {
    // Boot profile (possibly while disabled)
    if (baseRef.current?.session && !state.booted) {
      const { xterm, session } = baseRef.current;
      xterm.initialise();
      state.booted = true;

      // distinguish this instance of sessionKey from hot reloads
      props.updateTabMeta({
        key: /** @type {Key.TabId} */ (props.sessionKey),
        ttyBootedAt: Date.now(),
      });

      session.ttyShell.initialise(xterm).then(async () => {
        await state.storeAndSourceFuncs();
        state.update();
        await session.ttyShell.runProfile();
      });
    }
  }, [baseRef.current?.session, props.disabled]);

  return (
    <div className="h-full w-full" ref={rootRef}>
      <BaseTty
        ref={baseRef}
        sessionKey={props.sessionKey}
        env={props.env}
        onUnmount={state.reboot}
      />
      {baseRef.current?.session && (
        <TtyMenu
          canContOrStop={state.canContOrStop}
          disabled={props.disabled}
          session={baseRef.current.session}
          setTabsEnabled={props.setTabsEnabled}
        />
      )}
    </div>
  );
}

export interface Props extends BaseTabProps {
  sessionKey: `tty-${number}`;
  /** Can initialize variables */
  env: Partial<Session["var"]>;
  /**
   * 🚧
   * All js functions which induce shell functions.
   * They are partitioned by "fileKey".
   */
  // modules: import("./TtyWithFunctions").TtyJsModules;
  modules: {};
  /**
   * All shell files (*.sh and *.js.sh).
   * They are spread into `/etc`.
   */
  shFiles: Record<string, string>;
  /** Synced with e.g. profile-1.sh */
  profile: string;
  onKey?(e: KeyboardEvent): void;
}

// 🚧 eliminate
export interface BaseTabProps {
  tabKey: string;
  /**
   * A Tab is disabled if either:
   * - Tabs disabled (all tabs disabled)
   * - Tab is hidden (behind another tab).
   *
   * In the future we may permit disabling a visible Tab whilst Tabs enabled.
   */
  disabled?: boolean;
  /**
   * For example, can enable all tabs:
   * - onclick anywhere in a single tab (World)
   * - onclick a link (Tty)
   */
  setTabsEnabled(next: boolean): void;
  /**
   * Components can update their meta in tabs.store.
   * For example, Tty can update ttyBootedAt to distinguish
   * hot-reloaded sessions.
   */
  updateTabMeta(meta: TabStoreTabMeta): void;
}

// 🚧 eliminate
interface TabStoreTabMeta {
  key: string;
  disabled?: boolean;

  /**
   * TTY tab only: last recorded value of home.WORLD_KEY,
   * either via `awaitWorld` or clicking it in `Manage`.
   */
  ttyWorldKey?: string;
  ttyBootedAt?: number;
}
