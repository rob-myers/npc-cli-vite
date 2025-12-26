import { type JSh, reconstructReplParamExp } from "@npc-cli/parse-sh";
import { ExhaustiveError } from "@npc-cli/util";
import { jsStringify, last, parseJsArg, safeJsonParse } from "@npc-cli/util/legacy/generic";
import braces from "braces";
import { cmdService, preProcessWrite } from "./cmd-service";
import { ansi, bracesOpts, ProcessTag } from "./const";
import { redirectNode } from "./io";
import { cloneParsed, type NamedFunction } from "./parse";
import { sessionApi } from "./session.store";
import { ttyError } from "./tty-shell";
import {
  formatMessage,
  handleProcessError,
  interpretEscapeSequences,
  killError,
  matchFuncFormat,
  normalizeWhitespace,
  ShError,
  SigKillError,
} from "./util";

// 🚧
export class JShSemantics {
  private async applyRedirects(parent: JSh.Command, redirects: JSh.Redirect[]) {
    try {
      for (const redirect of redirects) {
        redirect.exitCode = 0;
        await this.Redirect(redirect);
      }
    } catch (e) {
      parent.exitCode = redirects.find((x) => x.exitCode)?.exitCode ?? 1;
      throw e;
    }
  }

  private async *assignVars(node: JSh.CallExpr) {
    for (const assign of node.Assigns) {
      yield* this.Assign(assign);
    }
  }

  private expand(values: string | unknown[]): Expanded {
    return {
      key: "expanded",
      values: Array.isArray(values) ? values : [values],
      value: Array.isArray(values) ? values.join(" ") : values,
    };
  }

  private expandParameter(meta: JSh.BaseMeta, varName: string): string {
    if (/^\d+$/.test(varName)) {
      // Positional
      return sessionApi.getPositional(meta.pid, meta.sessionKey, Number(varName));
    } // Otherwise we're retrieving a variable
    const varValue = sessionApi.getVar(meta, varName);
    if (varValue === undefined || typeof varValue === "string") {
      return varValue || "";
    } else {
      return jsStringify(varValue);
    }
  }

  private handleShError(node: JSh.ParsedSh, e: SigKillError | ShError, prefix?: string) {
    if (e instanceof SigKillError) {
      // Rethrow unless returning from a shell function
      return handleProcessError(node, e);
    }

    // Non-blocking write to stderr
    const message = [prefix, e.message].filter(Boolean).join(": ");
    const device = sessionApi.resolve(2, node.meta);
    if (device !== undefined) {
      const lines = message.split(/\r?\n/);
      device.writeData(
        `${lines.map((line) => formatMessage(line, "error")).join("\n")}${ansi.Reset}`,
      );
    } else {
      ttyError(`${node.meta.sessionKey}: pid ${node.meta.pid}: stderr does not exist`, message);
    }

    // Kill process in line with `set -e`
    node.exitCode = e.exitCode;
    throw killError(node.meta, e.exitCode);
  }

  handleTopLevelProcessError(e: SigKillError) {
    const session = sessionApi.getSession(e.sessionKey);
    if (session !== undefined) {
      sessionApi.kill(e.sessionKey, [e.pid], { GROUP: true, SIGINT: true });
      session.lastExit.fg = e.exitCode ?? 1;
    } else {
      ttyError(`session not found: ${e.sessionKey}`);
    }
  }

  private async lastExpanded(generator: AsyncGenerator<Expanded>) {
    let lastExpanded = undefined as Expanded | undefined;
    for await (const expanded of generator) lastExpanded = expanded;
    // biome-ignore lint/style/noNonNullAssertion: TODO justify
    return lastExpanded!;
  }

  private literal({ Value, parent }: JSh.Lit): string[] {
    if (!parent) {
      throw Error(`Literal must have parent`);
    }
    /**
     * Remove at most one '\\\n'; can arise interactively in quotes,
     * see https://github.com/mvdan/sh/issues/321.
     */
    let value = Value.replace(/\\\n/, "");

    if (parent.type === "DblQuoted") {
      // Double quotes: interpret ", \, $, `, no brace-expansion.
      return [value.replace(/\\(["\\$`])/g, "$1")];
    } else if (parent.type === "TestClause") {
      // [[ ... ]]: interpret everything, no brace-expansion.
      return [value.replace(/\\(.|$)/g, "$1")];
    } else if (parent.type === "Redirect") {
      // Redirection (e.g. here-doc): interpret everything, no brace-expansion.
      return [value.replace(/\\(.|$)/g, "$1")];
    }

    // support basic tilde expansion ~ or ~/foo
    if (value[0] === "~" && (value.length === 1 || value[1] === "/")) {
      value = value.replace("~", "/home");
    }

    // Otherwise interpret ', ", \, $, ` and apply brace-expansion.
    value = value.replace(/\\(['"\\$`])/g, "$1");

    if (/[[\]]/.test(value) === false) {
      return braces(value, bracesOpts);
    }

    // Escape square brackets to fix npm module `braces` e.g. [{1..5}]
    // Unescape afterwards e.g. for `expr [$points]`
    return braces(value.replace(/\[/g, "\\[").replace(/\]/g, "\\]"), bracesOpts).map((x) =>
      x.replace(/\\\[/g, "[").replace(/\\\]/g, "]"),
    );
  }

  /**
   * We normalise textual input e.g. via parameter substitution,
   * in order to construct a simple/compound command we can run.
   */
  private async performShellExpansion(Args: JSh.Word[]): Promise<string[]> {
    const expanded = [] as string[];
    for (const word of Args) {
      const result = await this.lastExpanded(this.Expand(word));
      word.exitCode ??= -1;
      const single = word.Parts.length === 1 ? word.Parts[0] : null;
      if (word.exitCode !== 0) {
        throw new ShError("failed to expand word", word.exitCode);
      } else if (single?.type === "SglQuoted") {
        expanded.push(result.value);
      } else if (single?.type === "ParamExp" || single?.type === "CmdSubst") {
        // e.g. ' foo \nbar ' -> ['foo', 'bar'].
        normalizeWhitespace(result.value).forEach((x) => void expanded.push(x));
      } else {
        result.values.forEach((x) => void expanded.push(x));
      }
    }
    return expanded;
  }

  private singleQuotes({ Dollar: interpret, Value }: JSh.SglQuoted) {
    return [interpret ? interpretEscapeSequences(Value) : Value];
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

  private async *Assign(node: JSh.Assign) {
    const { meta, Name, Value, Naked, Append } = node;

    node.exitCode = 1; // until proven innocent

    if (Name === null) {
      node.exitCode = 0;
      return; // e.g. `declare -F`
    }
    if (Naked === true || Value === null) {
      sessionApi.setVar(meta, Name.Value, "");
      node.exitCode = 0;
      return;
    }

    const { value, values } = await this.lastExpanded(sem.Expand(Value));
    const firstValue = values[0]; // know values.length > 0 because not Naked

    // biome-ignore lint/suspicious/noExplicitAny: TODO justify
    function objectAssignOrAdd(x: any, y: any) {
      return typeof y === "object" ? Object.assign(x, y) : x + y;
    }

    if (Append === true) {
      // Append `true` corresponds to `foo+=bar`, e.g.
      // - if x is `1` then after x+=1 it is `2`
      // - if x is `{foo:"bar"}` then after x+='{baz:"qux"}' it is `{foo:"bar",baz:"qux"}`
      const leftArg = sessionApi.getVar(meta, Name.Value) ?? 0;
      if (typeof firstValue !== "string") {
        // e.g. forward non-string value from command substitution `foo=$( bar )`
        sessionApi.setVar(meta, Name.Value, objectAssignOrAdd(leftArg, firstValue));
      } else {
        // string could be interpreted as e.g. number, Set
        sessionApi.setVar(meta, Name.Value, objectAssignOrAdd(leftArg, parseJsArg(value)));
      }
    } else {
      if (typeof firstValue !== "string") {
        // e.g. forward non-string value from command substitution `foo=$( bar )`
        sessionApi.setVar(meta, Name.Value, values.length === 1 ? values[0] : values);
      } else {
        // string could be interpreted as e.g. number, Set
        sessionApi.setVar(meta, Name.Value, parseJsArg(value));
      }
    }

    node.exitCode = 0;
  }

  private Block(node: JSh.Block) {
    return this.stmts(node, node.Stmts);
  }

  private async *CallExpr(node: JSh.CallExpr) {
    node.exitCode = 0;
    const args = await sem.performShellExpansion(node.Args);
    const [command, ...cmdArgs] = args;
    node.meta.verbose === true && console.log("simple command", args);

    if (args.length > 0) {
      let func: NamedFunction | undefined;
      if (cmdService.isCmd(command) === true) {
        yield* cmdService.runCmd(node, command, cmdArgs);
      } else if ((func = sessionApi.getFunc(node.meta.sessionKey, command)) !== undefined) {
        await cmdService.launchFunc(node, func, cmdArgs);
      } else {
        try {
          // Try to `get` things instead
          for (const arg of args) {
            const result = cmdService.get(node, [arg]);
            node.exitCode = result.length > 0 && result.every((x) => x === undefined) ? 1 : 0;
            if (result[0] !== undefined) {
              yield* result; // defined, or invoked defined-valued function
            } else if (matchFuncFormat(arg) !== null) {
              yield* result; // invoked a function returning undefined
            } else {
              // resolved undefined-valued variable
            }
          }
        } catch {
          throw new ShError("not found", 127);
        }
      }
    } else {
      yield* sem.assignVars(node);
    }
  }

  // 🚧
  /** Construct a simple command or a compound command. */
  private async Command(node: JSh.Command, Redirs: JSh.Redirect[]) {
    const cmdStackIndex = node.meta.stack.length;
    try {
      await sem.applyRedirects(node, Redirs);
      // biome-ignore lint/suspicious/noExplicitAny: TODO justify
      let generator: AsyncGenerator<any, void, unknown>;
      if (node.type === "CallExpr") {
        generator = this.CallExpr(node);
      } else {
        switch (node.type) {
          case "Block":
            generator = this.Block(node);
            break;
          // case "BinaryCmd":
          //   generator = this.BinaryCmd(node);
          //   break;
          // // syntax.LangBash only
          // case "DeclClause":
          //   generator = this.DeclClause(node);
          //   break;
          // case "ForClause":
          //   generator = this.ForClause(node);
          //   break;
          // case "FuncDecl":
          //   generator = this.FuncDecl(node);
          //   break;
          // case "IfClause":
          //   generator = this.IfClause(node);
          //   break;
          // case "TimeClause":
          //   generator = this.TimeClause(node);
          //   break;
          // case "Subshell":
          //   generator = this.Subshell(node);
          //   break;
          // case "WhileClause":
          //   generator = this.WhileClause(node);
          //   break;
          default:
            throw new ShError("not implemented", 2);
        }
      }
      const process = sessionApi.getProcess(node.meta);
      let stdoutFd = node.meta.fd[1];
      let device = sessionApi.resolve(1, node.meta);
      if (device === undefined) {
        // Pipeline already failed
        throw killError(node.meta);
      }
      // 🔔 Actually run the code
      for await (const item of generator) {
        try {
          await preProcessWrite(process, device);
          if (node.meta.fd[1] !== stdoutFd) {
            // e.g. `say` redirects stdout to /dev/voice
            stdoutFd = node.meta.fd[1];
            device = sessionApi.resolve(1, node.meta);
          }
          await device.writeData(item);
        } catch (e) {
          // reachable e.g. on twice reboot `poll` while paused
          await generator.throw(e);
        }
      }
    } catch (e) {
      const { stack } = node.meta;
      // now know CallExpr command (1st arg), although `foo=bar` has no command
      const command = node.type === "CallExpr" ? (node.Args[0]?.string ?? "CallExpr") : node.type;
      stack.splice(cmdStackIndex, 0, command);
      // normalize error
      const error =
        e instanceof ShError || e instanceof SigKillError ? e : new ShError("", 1, e as Error);
      error.message = `${stack.join(": ")}: ${(e as Error).message || e}`;
      if (command === "run" && stack.length === 1) {
        // when directly using `run` append helpful format message
        error.message +=
          "\n" +
          formatMessage(
            `usage: run '({ api:{read} }) { yield "foo"; yield await read(); }'`,
            "error",
          );
      }
      sem.handleShError(node, error);
    }
  }

  /**
   * Expand a `Word` which has `Parts`.
   */
  private async *Expand(node: JSh.Word) {
    if (node.Parts.length > 1) {
      for (const wordPart of node.Parts) {
        wordPart.string = (await this.lastExpanded(sem.ExpandPart(wordPart))).value;
      }
      /** Is last value a parameter/command-expansion AND has trailing whitespace? */
      let lastTrailing = false;
      /** Items can be arrays via brace expansion of literals */
      const values = [] as (string | string[])[];

      for (const part of node.Parts) {
        const value = part.string as string;
        // biome-ignore lint/suspicious/noExplicitAny: TODO justify
        const brace = part.type === "Lit" && !!(part as any).braceExp;

        if (part.type === "ParamExp" || part.type === "CmdSubst") {
          const vs = normalizeWhitespace(value, false); // Do not trim
          if (vs.length === 0) {
            continue;
          } else if (values.length === 0 || lastTrailing === true || vs[0].startsWith(" ")) {
            // Freely add, although trim 1st and last
            values.push(...vs.map((x) => x.trim()));
          } else if (Array.isArray(last(values))) {
            // prev brace exp
            const value = vs.join(" ").trim();
            values.push((values.pop() as string[]).map((x) => `${x}${value}`));
          } else {
            // Either `last(vs)` a trailing quote, or it has no trailing space
            // Since vs[0] has no leading space we must join words
            values.push(values.pop() + vs[0].trim());
            values.push(...vs.slice(1).map((x) => x.trim()));
          }
          lastTrailing = (last(vs) as string).endsWith(" ");
        } else if (values.length === 0 || lastTrailing === true) {
          // Freely add
          values.push(brace === true ? value.split(" ") : value);
          lastTrailing = false;
        } else if (Array.isArray(last(values))) {
          values.push(
            brace === true
              ? (values.pop() as string[]).flatMap((x) => value.split(" ").map((y) => `${x}${y}`))
              : (values.pop() as string[]).map((x) => `${x}${value}`),
          );
          lastTrailing = false;
        } else if (brace === true) {
          const prev = values.pop() as string;
          values.push(value.split(" ").map((x) => `${prev}${x}`));
          lastTrailing = false;
        } else {
          values.push(values.pop() + value);
          lastTrailing = false;
        }
      }

      const allValues = values.flat();
      node.string = allValues.join(" ");
      yield this.expand(allValues);
    } else {
      for await (const expanded of this.ExpandPart(node.Parts[0])) {
        node.string = expanded.value;
        yield expanded;
      }
    }
  }

  private async *ExpandPart(node: JSh.WordPart) {
    switch (node.type) {
      case "DblQuoted": {
        const output = [] as string[];
        for (const [_index, part] of node.Parts.entries()) {
          const result = await this.lastExpanded(sem.ExpandPart(part));
          if (part.type === "ParamExp" && part.Param.Value === "@") {
            output.push(
              ...(node.Parts.length === 1
                ? result.values // "$@" empty if `result.values` is
                : [`${output.pop() || ""}${result.values[0] || ""}`, ...result.values.slice(1)]),
            );
          } else {
            output.push(`${output.pop() || ""}${result.value || ""}`);
          }
        }
        yield this.expand(output);
        return;
      }
      case "Lit": {
        const literals = this.literal(node);
        // 🔔 HACK: pass `braceExp` to *Expand
        literals.length > 1 && Object.assign(node, { braceExp: true });
        yield this.expand(literals);
        break;
      }
      case "SglQuoted": {
        yield this.expand(this.singleQuotes(node));
        break;
      }
      case "CmdSubst": {
        const fifoKey = `/dev/fifo-cmd-${crypto.randomUUID()}`;
        const device = sessionApi.createFifo(fifoKey);
        const cloned = this.wrapInFile(cloneParsed(node));
        cloned.meta.fd[1] = device.key;
        cloned.meta.ppid = cloned.meta.pid;

        const { ttyShell } = sessionApi.getSession(node.meta.sessionKey);
        await ttyShell.spawn(cloned, {
          by: "$()",
          localVar: true,
        });

        try {
          const values = device.readAll();
          const wordParts =
            node.parent?.type === "Word" || node.parent?.type === "DblQuoted"
              ? node.parent.Parts
              : [];

          if (wordParts.length === 1 && (node.parent as JSh.ParsedSh).parent?.type === "Assign") {
            yield this.expand(values); // When `foo=$( bar )` forward non-string values
          } else {
            if (values.length > 1) {
              // yield expand(jsStringify(values));
              yield this.expand(values.map((x) => (typeof x === "string" ? x : jsStringify(x))));
            } else if (typeof values[0] === "string") {
              yield this.expand(values[0].replace(/\n*$/, ""));
            } else {
              yield this.expand(jsStringify(values[0]));
            }
          }
        } finally {
          sessionApi.removeDevice(device.key);
        }
        break;
      }
      case "ParamExp": {
        yield* this.ParamExp(node);
        return;
      }
      case "ArithmExp":
      case "ExtGlob":
      case "ProcSubst":
        break;
      default:
        throw new ExhaustiveError(node);
    }
  }

  File(node: JSh.File) {
    return sem.stmts(node, node.Stmts);
  }

  /**
   * 1. $0, $1, ... Positionals
   * 2. "${@}" All positionals
   * 3. $x, ${foo} Vanilla expansions
   * 4. ${foo:-bar} Default when empty
   * 5. ${_/foo/bar/baz} Path into last interactive non-string
   * 6. $$ PID of current process (Not quite the same as bash)
   * 7. $? Exit code of last completed process
   */
  private async *ParamExp(node: JSh.ParamExp): AsyncGenerator<Expanded, void, unknown> {
    const { meta, Param, Slice, Repl, Length, Excl, Exp } = node;
    if (Repl !== null) {
      // ${_/foo/bar/baz}
      const origParam = reconstructReplParamExp(Repl);
      const result = cmdService.get(node, [origParam]);
      node.exitCode = result.length > 0 && result.every((x) => x === undefined) ? 1 : 0;
      yield this.expand(jsStringify(result[0]));
    } else if (Excl || Length || Slice) {
      throw new ShError(`ParamExp: ${Param.Value}: unsupported operation`, 2);
    } else if (Exp !== null) {
      switch (Exp.Op) {
        case ":-": {
          const value = this.expandParameter(meta, Param.Value);
          yield value === "" && Exp.Word
            ? await this.lastExpanded(this.Expand(Exp.Word))
            : this.expand(value);
          break;
        }
        default:
          throw new ShError(`ParamExp: ${Param.Value}: unsupported operation`, 2);
      }
    } else if (Param.Value === "@") {
      yield this.expand(sessionApi.getProcess(meta).positionals.slice(1));
    } else if (Param.Value === "$") {
      yield this.expand(`${sessionApi.getProcess(meta).key}`);
    } else if (Param.Value === "*") {
      yield this.expand(sessionApi.getProcess(meta).positionals.slice(1).join(" "));
    }
    // else if (Param.Value === "$") {
    //   yield this.expand(`${meta.pid}`);
    // }
    else if (Param.Value === "?") {
      yield this.expand(`${sessionApi.getLastExitCode(meta)}`);
    } else if (Param.Value === "!") {
      yield this.expand(`${sessionApi.getSession(meta.sessionKey).lastBg}`);
    } else if (Param.Value === "#") {
      yield this.expand(`${sessionApi.getProcess(meta).positionals.slice(1).length}`);
    } else {
      yield this.expand(this.expandParameter(meta, Param.Value));
    }
  }

  private async Redirect(node: JSh.Redirect) {
    const srcValue = node.N === null ? null : node.N.Value;
    const srcFd = srcValue === null ? 1 : safeJsonParse(srcValue);
    if (!(typeof srcFd === "number" && Number.isInteger(srcFd) === true && srcFd >= 0)) {
      throw new ShError(`${node.Op}: bad file descriptor: "${srcValue}"`, 127);
    }

    if (node.Op === ">&") {
      const { value: dstValue } = await this.lastExpanded(sem.Expand(node.Word));
      const dstFd = safeJsonParse(dstValue);
      if (!(typeof dstFd === "number" && Number.isInteger(dstFd) === true && dstFd >= 0)) {
        throw new ShError(`${node.Op}: bad file descriptor: "${dstValue}"`, 127);
      }

      return redirectNode(node.parent as JSh.ParsedSh, { [srcFd]: node.meta.fd[dstFd] });
    }

    if (node.Op === ">" || node.Op === ">>" || node.Op === "&>>") {
      const { value } = await this.lastExpanded(sem.Expand(node.Word));
      if (value === "/dev/null") {
        return redirectNode(node.parent as JSh.ParsedSh, { [srcFd]: "/dev/null" });
      } else if (value === "/dev/voice") {
        return redirectNode(node.parent as JSh.ParsedSh, { [srcFd]: "/dev/voice" });
      } else {
        cmdService.redirectToVar(
          node.parent as JSh.ParsedSh,
          srcFd,
          value,
          node.Op === ">" ? "last" : node.Op === ">>" ? "array" : "fresh-array",
        );
        return;
      }
    }

    throw new ShError(`${node.Op}: unsupported redirect`, 127);
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

export interface Expanded {
  key: "expanded";
  values: any[];
  /** This is values.join(' ') */
  value: string;
}
