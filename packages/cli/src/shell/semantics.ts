import type { JSh } from "@npc-cli/parse-sh";
import { cloneParsed } from "../main";
import { ProcessTag } from "./const";
import { sessionApi } from "./session.store";
import { ttyError } from "./tty-shell";
import { ShError, SigKillError } from "./util";

// 🚧
export class JShSemantics {
  handleTopLevelProcessError(e: SigKillError) {
    const session = sessionApi.getSession(e.sessionKey);
    if (session !== undefined) {
      sessionApi.kill(e.sessionKey, [e.pid], { GROUP: true, SIGINT: true });
      session.lastExit.fg = e.exitCode ?? 1;
    } else {
      ttyError(`session not found: ${e.sessionKey}`);
    }
  }

  private async *stmts(parent: JSh.ParsedSh, nodes: JSh.Stmt[]) {
    parent.exitCode = 0;
    for (const node of nodes) {
      try {
        yield* sem.Stmt(node);
      } finally {
        parent.exitCode = node.exitCode;
        sessionApi.setLastExitCode(node.meta, node.exitCode);
      }
    }
  }

  /** Convert node to FileWithMeta, so it can be used to drive a process. */
  private wrapInFile(
    node: JSh.Stmt | JSh.CmdSubst | JSh.Subshell,
    metaOverride?: Partial<JSh.BaseMeta>,
  ): JSh.FileWithMeta {
    return {
      type: "File",
      Stmts: node.type === "Stmt" ? [node] : node.Stmts,
      meta: Object.assign(node.meta, metaOverride),
    } as JSh.FileWithMeta;
  }

  // 🚧
  /** Construct a simple command or a compound command. */
  //@ts-expect-error
  private async Command(node: JSh.Command, Redirs: JSh.Redirect[]) {
    // const cmdStackIndex = node.meta.stack.length;
    // try {
    //   await sem.applyRedirects(node, Redirs);
    //   let generator: AsyncGenerator<any, void, unknown>;
    //   if (node.type === "CallExpr") {
    //     generator = this.CallExpr(node);
    //   } else {
    //     switch (node.type) {
    //       case "Block":
    //         generator = this.Block(node);
    //         break;
    //       case "BinaryCmd":
    //         generator = this.BinaryCmd(node);
    //         break;
    //       // syntax.LangBash only
    //       case "DeclClause":
    //         generator = this.DeclClause(node);
    //         break;
    //       case "ForClause":
    //         generator = this.ForClause(node);
    //         break;
    //       case "FuncDecl":
    //         generator = this.FuncDecl(node);
    //         break;
    //       case "IfClause":
    //         generator = this.IfClause(node);
    //         break;
    //       case "TimeClause":
    //         generator = this.TimeClause(node);
    //         break;
    //       case "Subshell":
    //         generator = this.Subshell(node);
    //         break;
    //       case "WhileClause":
    //         generator = this.WhileClause(node);
    //         break;
    //       default:
    //         throw new ShError("not implemented", 2);
    //     }
    //   }
    //   const process = getProcess(node.meta);
    //   let stdoutFd = node.meta.fd[1];
    //   let device = useSession.api.resolve(1, node.meta);
    //   if (device === undefined) {// Pipeline already failed
    //     throw killError(node.meta);
    //   }
    //   // 🔔 Actually run the code
    //   for await (const item of generator) {
    //     try {
    //       await preProcessWrite(process, device);
    //       if (node.meta.fd[1] !== stdoutFd) {
    //         // e.g. `say` redirects stdout to /dev/voice
    //         stdoutFd = node.meta.fd[1];
    //         device = useSession.api.resolve(1, node.meta);
    //       }
    //       await device.writeData(item);
    //     } catch (e) {// reachable e.g. on twice reboot `poll` while paused
    //       await generator.throw(e);
    //     }
    //   }
    // } catch (e) {
    //   const { stack } = node.meta;
    //   // now know CallExpr command (1st arg), although `foo=bar` has no command
    //   const command = node.type === 'CallExpr' ? node.Args[0]?.string ?? 'CallExpr' : node.type;
    //   stack.splice(cmdStackIndex, 0, command);
    //   // normalize error
    //   const error = e instanceof ShError || e instanceof ProcessError
    //     ? e
    //     : new ShError("", 1, e as Error)
    //   ;
    //   error.message = `${stack.join(": ")}: ${(e as Error).message || e}`;
    //   if (command === "run" && stack.length === 1) {
    //     // when directly using `run` append helpful format message
    //     error.message += '\n' + formatMessage(`usage: run '({ api:{read} }) { yield "foo"; yield await read(); }'`, 'error');
    //   }
    //   sem.handleShError(node, error);
    // }
  }

  File(node: JSh.File) {
    return sem.stmts(node, node.Stmts);
  }

  private async *Stmt(stmt: JSh.Stmt) {
    if (stmt.Cmd === null) {
      throw new ShError("pure redirects unsupported", 2);
    }

    if (stmt.Background === true && stmt.meta.pgid === 0) {
      const { ttyShell, nextPid } = sessionApi.getSession(stmt.meta.sessionKey);

      const cloned = cloneParsed(stmt);
      cloned.Background = false; // remove "&"
      const file = this.wrapInFile(cloned, {
        ppid: stmt.meta.pid,
        pgid: nextPid,
        background: true,
      });

      // Run a background process without awaiting
      ttyShell
        .spawn(file, {
          by: "&",
          localVar: true,
          ptags: { [ProcessTag.interactive]: undefined }, // delete process tag
        })
        .catch((e) => {
          if (e instanceof SigKillError) {
            this.handleTopLevelProcessError(e);
          } else {
            ttyError("background process error\n\n", e);
          }
        });

      // e.g. `! { sleep 10 & }` has immediate exit code 1
      stmt.exitCode = stmt.Negated === true ? 1 : 0;
      return;
    }

    try {
      // Run a simple or compound command
      await sem.Command(stmt.Cmd, stmt.Redirs);
    } finally {
      stmt.exitCode = stmt.Cmd.exitCode;
      stmt.Negated === true && (stmt.exitCode = 1 - Number(!!stmt.Cmd.exitCode));
    }
  }
}

export const jShSemantics = new JShSemantics();

/** Local shortcut */
const sem = jShSemantics;
