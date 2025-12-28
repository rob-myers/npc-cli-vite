/**
 * Based on https://www.npmjs.com/package/cli-high
 */

import { tokenize } from 'sugar-high'
import { ansi } from "./const";

export function highlight(code: string) {
  const tokens = tokenize(code);
  return ansi.Hex323232Bg + tokens.map(getCharsFromToken).join('');
}

function getCharsFromToken([type, value]: [number, string]) {
  // console.log(type, value);
  switch (type) {
    // case 0: // identifier
    //   // return chalk.pink(value)
    //   return ansi.Purple + value
    // case 1: // keyword
    //   return ansi.Grey + value
    // case 2: // string
    //   return ansi.Grey + value
    // case 3: // Class, number and null
    //   return ansi.BrightYellow + value
    // case 4: // property
    //   // return chalk.pink(value)
    //   return ansi.Purple + value
    // case 5: // entity
    //   return ansi.Purple + value
    // case 6: // jsx literals
    //   // return chalk.whiteSecondary(value)
    //   return ansi.White + value
    case 7: // sign
      // return ansi.Grey + value
      return ansi.BlueBold + value + ansi.BoldReset;
    // case 8: // comment
    //   return ansi.DarkGrey + value
    default:
      // return value
      return ansi.Yellow + value
  }
}
