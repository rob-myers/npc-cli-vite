import * as THREE from "three";
import { npcSpeechBubbleOpacityCssVar } from "../const";

/**
 * 🔔 Avoid function-valued properties: our HMR strategy doesn't handle them,
 * in particular they won't be overwritten when the function is changed.
 */
export class SpeechBubbleApi {
  /** For violating React.memo */
  epochMs = 0;

  /** @type {import('../components/Html3d').State} */
  html3d = /** @type {*} */ (null);
  // /** @type {import('../components/PopUp').State} */
  // popUp = /** @type {*} */ (null);
  uiRootEl = /** @type {null | HTMLDivElement} */ (null);

  position = new THREE.Vector3();
  tracked = /** @type {null | import('../components/Html3d').TrackedObject3D} */ (null);
  offset = { x: 0, y: 0, z: 0 };

  resolveOnMount = noop;
  // speech = /** @type {string | null} */ (null);
  // thought = /** @type {{ [key: string]: NPC.BubbleThought }} */ ({});
  // /** `Object.values(this.thought)` */
  // thoughts = /** @type {NPC.BubbleThought[]} */ ([]);

  /**
   * @param {string} key
   * @param {import('./World').State} w
   */
  constructor(key, w) {
    /** @type {string} */
    this.key = key;
    /** @type {import('./World').State} */
    this.w = w;
    /** @type {string} */
    this.selectElName = `${key}-bubble-options`;
  }

  // /**
  //  * Forgetting disables the thought, it does not remove it.
  //  * @param {string} thoughtKey
  //  */
  // deleteThought(thoughtKey) {
  //   delete this.thought[thoughtKey];
  //   this.thoughts = Object.values(this.thought);
  //   this.update();
  // }

  dispose() {
    this.tracked = null;
    this.update = noop;
    // @ts-expect-error
    this.w = null;
    this.html3dRef(null);
  }

  /**
   * @param {React.PointerEvent} e
   */
  forwardPointerEvents(e) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new PointerEvent(e.nativeEvent.type, e.nativeEvent));
  }

  /**
   * @param {React.WheelEvent} e
   */
  forwardWheelEvents(e) {
    e.stopPropagation();
    this.w.view.canvas.dispatchEvent(new WheelEvent(e.nativeEvent.type, e.nativeEvent));
  }

  /** @param {null | import('../components/Html3d').State} html3d */
  html3dRef(html3d) {
    if (html3d !== null) {
      this.html3d = html3d;
    } else {
      // @ts-expect-error
      delete this.html3d;
    }
  }

  // isThoughtBubbleEmpty() {
  //   return this.thoughts.length === 0 && this.uiRootEl?.childElementCount === 0;
  // }

  isMounted() {
    return this.uiRootEl !== null;
  }

  // /**
  //  * @param {React.MouseEvent} e
  //  */
  // onClickThoughts(e) {
  //   if (!(e.target instanceof HTMLButtonElement)) {
  //     return;
  //   }

  //   const { deleteThoughtKey } = e.target.dataset;
  //   if (deleteThoughtKey !== undefined) {
  //     this.deleteThought(deleteThoughtKey);
  //     return;
  //   }

  //   const { thoughtKey, buttonKey } = e.target.dataset;
  //   if (thoughtKey !== undefined && buttonKey !== undefined) {
  //     this.w.events.next({ key: 'click-thought', npcKey: this.key, thoughtKey, buttonKey });
  //   }
  // }

  // /** @param {boolean} willOpen */
  // onPopUpChange(willOpen) {
  //   if (willOpen === false) {
  //     this.thoughts.forEach(t => t.disabled && delete this.thought[t.key]);
  //     this.thoughts = Object.values(this.thought);
  //     pause(300).then(this.update);
  //   }
  // }

  // /** @param {null | import('@/npc-cli/components/PopUp').State} popUp */
  // popUpRef(popUp) {
  //   if (popUp !== null) {
  //     this.popUp = popUp;
  //   } else {// @ts-expect-error
  //     delete this.popUp;
  //   }
  // }

  /** @param {number} opacityDst */
  setOpacity(opacityDst) {
    this.html3d.rootDiv.style.setProperty(npcSpeechBubbleOpacityCssVar, `${opacityDst}`);
  }

  /** @param {null | string} speech */
  setSpeech(speech) {
    this.speech = speech;
    this.epochMs = Date.now();
    this.update();
  }

  /**
   * @param {import('../components/Html3d').TrackedObject3D} tracked
   */
  setTracked(tracked) {
    this.tracked = tracked;
  }

  // /**
  //  * - Add thought, or
  //  * - Disable extant via empty `parts`
  //  * @param {string} thoughtKey
  //  * @param {...string} parts
  //  */
  // think(thoughtKey, ...parts) {
  //   if (thoughtKey === undefined) {
  //     throw Error('thoughtKey is required');
  //   }
  //   if (parts.length === 0) {
  //     if (thoughtKey in this.thought) {
  //       this.thought[thoughtKey].disabled = true;
  //     }
  //   } else {
  //     this.thought[thoughtKey] = {
  //       key: thoughtKey,
  //       def: parts.join(' '),
  //       // e.g. ['get in', ['bed'], 'right now']
  //       parts: parts.reduce((acc, x) => {
  //         if (x.startsWith('[') && x.endsWith(']')) acc.push([x.slice(1, -1)]);
  //         else if (typeof acc.at(-1) === 'string') acc[acc.length - 1] += ` ${x}`;
  //         else acc.push(x);
  //         return acc;
  //       }, /** @type {(string | [string])[]} */ ([])),
  //     };
  //   }

  //   this.thoughts = Object.values(this.thought);
  //   this.update();
  // }

  /** @param {null | HTMLDivElement} uiRootEl */
  thoughtUiRef(uiRootEl) {
    if (uiRootEl !== null) {
      this.uiRootEl = uiRootEl;
    } else {
      // @ts-expect-error
      delete this.uiRootEl;
    }
  }

  update = noop;
}

function noop() {}
