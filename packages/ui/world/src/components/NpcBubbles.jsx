import { useStateRef } from "@npc-cli/util";
import React from "react";
import { Html3d } from "../components/Html3d";
import { SpeechBubbleApi } from "./speech-bubble-api";
import { WorldContext } from "./world-context";

export default function NpcSpeechBubbles() {
  const w = React.useContext(WorldContext);

  const state = useStateRef(
    /** @returns {State} */ () => ({
      byKey: {},
      lastFront: "",
      delete(...npcKeys) {
        for (const npcKey of npcKeys) {
          state.byKey[npcKey]?.dispose();
          delete state.byKey[npcKey];
          // w.n[npcKey]?.showLabel(true);
        }
        state.update();
      },
      ensure(npcKey) {
        let bubble = state.byKey[npcKey];
        if (!bubble) {
          bubble = state.byKey[npcKey] = new SpeechBubbleApi(npcKey, w);
          const npc = w.npc.get(npcKey);
          bubble.setTracked({ object: npc.skinnedMesh, offset: npc.bubbleOffset });
          state.update();
        }
        return bubble;
      },
      async ensureMounted(npcKey) {
        const bubble = state.ensure(npcKey);
        if (!bubble.isMounted()) {
          await /** @type {Promise<void>} */ (
            new Promise((resolve) => {
              bubble.resolveOnMount = resolve;
              bubble.epochMs = Date.now();
              state.update();
            })
          );
        }
        return bubble;
      },
      toFront(npcKey) {
        const prevBubbleDiv = state.byKey[state.lastFront]?.html3d.rootDiv;
        if (prevBubbleDiv) prevBubbleDiv.style.zIndex = "";
        const bubbleDiv = state.byKey[npcKey].html3d.rootDiv;
        bubbleDiv.style.zIndex = `20`; // 🚧
        state.lastFront = npcKey;
      },
    }),
  );

  w.bubble = state;
  w.b = state.byKey;

  React.useMemo(() => {
    // HMR
    if (import.meta.env.DEV) {
      for (const bubble of Object.values(state.byKey)) {
        // copy over (a) new properties, (b) prototype
        // assuming there are no function-valued properties (they won't be overwritten)
        const tempBubble = new SpeechBubbleApi(bubble.key, w);
        Object.assign(bubble, { ...tempBubble }, { ...bubble });
        Object.setPrototypeOf(bubble, Object.getPrototypeOf(tempBubble));
      }
    }
  }, []);

  return Object.values(state.byKey).map((bubble) => (
    <MemoizedSpeechBubble key={bubble.key} bubble={bubble} epochMs={bubble.epochMs} />
  ));
}

/**
 * @typedef State
 * @property {string} lastFront npcKey
 * @property {(...npcKeys: string[]) => void} delete
 * @property {(npcKey: string) => SpeechBubbleApi} ensure
 * @property {(npcKey: string) => Promise<SpeechBubbleApi>} ensureMounted
 * Sometimes we want to await mount e.g. thoughts need htmlelement portalParent
 * @property {{ [npcKey: string]: SpeechBubbleApi }} byKey
 * @property {(npcKey: string) => void} toFront
 */

/**
 * @param {SpeechBubbleProps} props
 */
function NpcSpeechBubble({ bubble: b }) {
  React.useEffect(() => {
    setTimeout(() => {
      b.update(); // Extra render e.g. for speak while paused
      b.resolveOnMount(); // Resolve after 30ms else uiRootEl n/a
    }, 30);
  }, []);

  return (
    <Html3d
      ref={b.html3dRef.bind(b)}
      className="absolute top-[-16px] left-[calc(-1/2_*_var(--speech-bubble-width)_+_10px)] pointer-events-none [&>div]:flex [&>div]:justify-center"
      baseScale={speechBubbleBaseScale}
      offset={b.offset}
      position={b.position}
      r3f={b.w.r3f}
      tracked={b.tracked}
      // docked
      visible
    >
      <div className="bubble flex text-[#ff9] leading-[1.2]">
        <div className="flex flex-wrap text-white">
          Hello, world!
          {/* <PopUp
            ref={b.popUpRef.bind(b)}
            className="pointer-events-auto"
            deltaArrowLeft={28}
            label={<NpcKeyUi npcKey={b.key} />}
            left={false}
            top={false}
            width={100}
            onWheel={b.forwardWheelEvents.bind(b)}
            onChange={b.onPopUpChange.bind(b)}
          >
            <div className="flex flex-col items-center text-[1.4rem]" onClick={b.onClickThoughts.bind(b)}>
              {b.thoughts.length === 0
                ? "⋯"
                : b.thoughts.map((thought) => <Thought key={thought.key} thought={thought} />)}
              <div ref={b.thoughtUiRef.bind(b)} className="w-full flex flex-wrap justify-center [&>*]:py-1" />
            </div>
          </PopUp> */}
        </div>

        {/* {b.speech && (
          <div className="flex items-center line-clamp-2 py-1 px-1 ml-1 text-[1.2rem] border-[1px] rounded-[4px] border-[rgba(255,255,255,0.3)] bg-[rgba(0,0,0,0.2)] ">
            {b.speech}
          </div>
        )} */}
      </div>
    </Html3d>
  );
}

// /** @param {{ npcKey: string; className?: string }} props */
// function NpcKeyUi({ npcKey, className }) {
//   return (
//     <div
//       className={clsx(
//         className,
//         "flex justify-center h-full w-[64px] max-w-[64px] break-all items-center px-1.5 py-1 text-[1rem] font-normal rounded-[16px] text-black bg-[#fff6]",
//       )}
//     >
//       {npcKey}
//     </div>
//   );
// }

// /** @param {{ thought: NPC.BubbleThought }} props */
// function Thought({ thought }) {
//   return (
//     <p
//       className={clsx(
//         "flex flex-wrap py-0.5 justify-center gap-x-1 gap-y-0 whitespace-break-spaces text-center text-[1rem]",
//         thought.disabled && "text-[#999]",
//       )}
//     >
//       {thought.parts.map((part) =>
//         Array.isArray(part) ? (
//           <button
//             key={part[0]}
//             data-thought-key={thought.key}
//             data-button-key={part[1] ?? part[0]}
//             disabled={thought.disabled}
//             className="inline-block text-[#99f] underline whitespace-nowrap disabled:text-[#999]"
//           >
//             {part[0]}
//           </button>
//         ) : (
//           part
//         ),
//       )}
//       {thought.disabled === true && (
//         <button
//           data-delete-thought-key={thought.key}
//           className="text-[0.7rem] text-[#f99] no-underline whitespace-nowrap"
//         >
//           x
//         </button>
//       )}
//     </p>
//   );
// }

/**
 * @typedef SpeechBubbleProps
 * @property {SpeechBubbleApi} bubble
 */

/** @type {React.MemoExoticComponent<(props: SpeechBubbleProps & { epochMs: number }) => React.JSX.Element>} */
const MemoizedSpeechBubble = React.memo(NpcSpeechBubble);

const speechBubbleBaseScale = 4;

// const npcSpeechBubbleCss = css`
//   --speech-bubble-width: 280px;

//   > div {
//     width: var(--speech-bubble-width);
//     opacity: var(${npcSpeechBubbleOpacityCssVar});
//     transition: opacity 300ms;
//   }
// `;
