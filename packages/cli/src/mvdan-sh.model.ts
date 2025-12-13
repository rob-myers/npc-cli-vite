export type LangVariant = typeof LangVariant;

export const LangVariant = {
  /**
   * LangBash corresponds to the GNU Bash language, as described in its manual
   * at https://www.gnu.org/software/bash/manual/bash.html.
   *
   * We currently follow Bash version 5.2.
   *
   * Its string representation is "bash".
   */
  LangBash: 0,
  /**
   * LangPOSIX corresponds to the POSIX Shell language, as described at
   * https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html.
   *
   * Its string representation is "posix" or "sh".
   */
  LangPOSIX: 1,
  /**
   * LangMirBSDKorn corresponds to the MirBSD Korn Shell, also known as mksh, as
   * described at http://www.mirbsd.org/htman/i386/man1/mksh.htm. Note that it
   * shares some features with Bash, due to the shared ancestry that is ksh.
   *
   * We currently follow mksh version 59.
   *
   * Its string representation is "mksh".
   */
  LangMirBSDKorn: 2,
  /**
   * LangBats corresponds to the Bash Automated Testing System language, as
   * described at https://github.com/bats-core/bats-core. Note that it's just a
   * small extension of the Bash language.
   *
   * Its string representation is "bats".
   */
  LangBats: 3,
  /**
   * LangAuto corresponds to automatic language detection, commonly used by
   * end-user applications like shfmt, which can guess a file's language variant
   * given its filename or shebang.
   *
   * At this time, [Variant] does not support LangAuto.
   */
  LangAuto: 4,
} as const;
