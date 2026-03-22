import { uiClassName } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { useRef, useState } from "react";
import type { PeerState } from "./use-webrtc";
import { useWebRtc } from "./use-webrtc";

export function WebRtcPeer() {
  const rtc = useWebRtc();
  const [msgInput, setMsgInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const connectedCount = rtc.peers.filter((p) => p.status === "connected").length;

  return (
    <div className={cn(uiClassName, "flex flex-col gap-3 p-4 max-w-lg w-full text-xs")}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">WebRTC Peers</span>
        <span className="text-slate-400 text-[10px]">
          {connectedCount}/{rtc.peers.length} connected
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="cursor-pointer px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded"
          onClick={() => rtc.createOffer()}
        >
          Create Offer
        </button>
        <button
          type="button"
          className="cursor-pointer px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded"
          onClick={() => {
            const text = prompt("Paste the offer string:");
            if (text?.trim()) rtc.acceptOffer(text.trim());
          }}
        >
          Join (Paste Offer)
        </button>
      </div>

      {rtc.peers.length > 0 && (
        <div className="flex flex-col gap-2">
          {rtc.peers.map((peer) => (
            <PeerCard key={peer.id} peer={peer} rtc={rtc} />
          ))}
        </div>
      )}

      <div
        ref={logRef}
        className="bg-slate-900 border border-slate-700 rounded p-2 h-40 overflow-auto flex flex-col gap-0.5"
      >
        {rtc.messages.length === 0 && (
          <span className="text-slate-500 italic">No messages yet</span>
        )}
        {rtc.messages.map((msg, i) => (
          <div key={i} className={cn(msg.from === "local" ? "text-blue-400" : "text-green-400")}>
            <span className="text-slate-500">
              {msg.from === "local" ? "you" : msg.peerId}:
            </span>{" "}
            {msg.text}
          </div>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (msgInput.trim()) {
            rtc.send(msgInput.trim());
            setMsgInput("");
            setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 0);
          }
        }}
      >
        <input
          type="text"
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Send to all connected peers..."
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1"
        />
        <button
          type="submit"
          disabled={connectedCount === 0}
          className="cursor-pointer px-3 py-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white rounded"
        >
          Send
        </button>
      </form>

      {rtc.messages.length > 0 && (
        <button
          type="button"
          className="cursor-pointer self-start text-slate-400 hover:text-red-400"
          onClick={rtc.clearMessages}
        >
          Clear chat
        </button>
      )}
    </div>
  );
}

function PeerCard({ peer, rtc }: { peer: PeerState; rtc: ReturnType<typeof useWebRtc> }) {
  const [answerInput, setAnswerInput] = useState("");

  return (
    <div className="bg-slate-900 border border-slate-700 rounded p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px]">{peer.label}</span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px]",
              peer.status === "connected" && "bg-green-800 text-green-200",
              peer.status === "disconnected" && "bg-red-900 text-red-200",
              peer.status === "idle" && "bg-slate-700 text-slate-300",
              !["connected", "disconnected", "idle"].includes(peer.status) &&
                "bg-yellow-900 text-yellow-200",
            )}
          >
            {peer.status}
          </span>
          {peer.status === "connected" && (
            <button
              type="button"
              className="cursor-pointer text-yellow-400 hover:text-yellow-300 text-[10px]"
              onClick={() => rtc.disconnectPeer(peer.id)}
            >
              Disconnect
            </button>
          )}
          {peer.status === "disconnected" && peer.role === "offerer" && (
            <button
              type="button"
              className="cursor-pointer text-blue-400 hover:text-blue-300 text-[10px]"
              onClick={() => rtc.createOffer(peer.id)}
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            className="cursor-pointer text-slate-500 hover:text-red-400 text-[10px]"
            onClick={() => rtc.removePeer(peer.id)}
          >
            Remove
          </button>
        </div>
      </div>

      {peer.localSdp && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-[10px]">
              {peer.status === "awaiting-answer" ? "Offer:" : "Answer:"}
            </span>
            <button
              type="button"
              className="cursor-pointer text-blue-400 hover:text-blue-300 text-[10px]"
              onClick={() => navigator.clipboard.writeText(peer.localSdp ?? "")}
            >
              Copy
            </button>
          </div>
          <textarea
            readOnly
            value={peer.localSdp}
            rows={2}
            className="w-full bg-slate-800 border border-slate-600 rounded p-1 text-[9px] font-mono select-all resize-none"
          />
        </div>
      )}

      {peer.status === "awaiting-answer" && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={answerInput}
            onChange={(e) => setAnswerInput(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Paste answer..."
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 font-mono text-[9px]"
          />
          <button
            type="button"
            className="cursor-pointer px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded text-[10px]"
            onClick={() => {
              if (answerInput.trim()) {
                rtc.acceptAnswer(peer.id, answerInput.trim());
                setAnswerInput("");
              }
            }}
          >
            Connect
          </button>
        </div>
      )}
    </div>
  );
}
