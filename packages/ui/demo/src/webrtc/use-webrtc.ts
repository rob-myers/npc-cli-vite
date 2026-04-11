import { useCallback, useEffect, useRef, useState } from "react";

export type PeerStatus = "idle" | "offering" | "awaiting-answer" | "answering" | "connected" | "disconnected";

export interface PeerState {
  id: string;
  label: string;
  status: PeerStatus;
  localSdp: string | null;
  role: "offerer" | "answerer";
}

export interface ChatMessage {
  peerId: string;
  from: "local" | "remote";
  text: string;
}

interface PeerConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function encodeSdp(sdp: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(sdp));
}

function decodeSdp(encoded: string): RTCSessionDescriptionInit {
  return JSON.parse(atob(encoded));
}

let nextPeerId = 1;

export function useWebRtc() {
  const connectionsRef = useRef(new Map<string, PeerConnection>());
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const updatePeer = useCallback((id: string, update: Partial<PeerState>) => {
    setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, ...update } : p)));
  }, []);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const closePeerConnection = useCallback((id: string) => {
    const conn = connectionsRef.current.get(id);
    if (conn) {
      conn.dc?.close();
      conn.pc.close();
      connectionsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const id of connectionsRef.current.keys()) {
        closePeerConnection(id);
      }
    };
  }, [closePeerConnection]);

  const setupPeerConnection = useCallback(
    (id: string, pc: RTCPeerConnection) => {
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
          updatePeer(id, { status: "disconnected" });
        }
      };
    },
    [updatePeer],
  );

  const setupDataChannel = useCallback(
    (id: string, dc: RTCDataChannel) => {
      const conn = connectionsRef.current.get(id);
      if (conn) conn.dc = dc;
      dc.onopen = () => updatePeer(id, { status: "connected" });
      dc.onclose = () => updatePeer(id, { status: "disconnected" });
      dc.onmessage = (e) => addMessage({ peerId: id, from: "remote", text: e.data });
    },
    [updatePeer, addMessage],
  );

  const waitForIceCandidates = useCallback((pc: RTCPeerConnection): Promise<void> => {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") resolve();
      };
    });
  }, []);

  const createOffer = useCallback(
    async (existingId?: string) => {
      const id = existingId ?? `peer-${nextPeerId++}`;

      // close previous connection if reconnecting
      closePeerConnection(id);

      const pc = new RTCPeerConnection(rtcConfig);
      setupPeerConnection(id, pc);
      const dc = pc.createDataChannel("chat");
      connectionsRef.current.set(id, { pc, dc: null });
      setupDataChannel(id, dc);

      setPeers((prev) => {
        const idx = prev.findIndex((p) => p.id === id);
        const peer: PeerState = { id, label: id, status: "offering", localSdp: null, role: "offerer" };
        return idx >= 0 ? prev.map((p) => (p.id === id ? { ...peer, role: p.role } : p)) : [...prev, peer];
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceCandidates(pc);

      if (pc.localDescription) {
        updatePeer(id, { status: "awaiting-answer", localSdp: encodeSdp(pc.localDescription) });
      }
      return id;
    },
    [closePeerConnection, setupPeerConnection, setupDataChannel, waitForIceCandidates, updatePeer],
  );

  const acceptAnswer = useCallback(async (id: string, encodedAnswer: string) => {
    const conn = connectionsRef.current.get(id);
    if (!conn) return;
    await conn.pc.setRemoteDescription(decodeSdp(encodedAnswer));
  }, []);

  const acceptOffer = useCallback(
    async (encodedOffer: string, existingId?: string) => {
      const id = existingId ?? `peer-${nextPeerId++}`;

      closePeerConnection(id);

      const pc = new RTCPeerConnection(rtcConfig);
      setupPeerConnection(id, pc);
      connectionsRef.current.set(id, { pc, dc: null });
      pc.ondatachannel = (e) => setupDataChannel(id, e.channel);

      setPeers((prev) => {
        const idx = prev.findIndex((p) => p.id === id);
        const peer: PeerState = { id, label: id, status: "answering", localSdp: null, role: "answerer" };
        return idx >= 0 ? prev.map((p) => (p.id === id ? { ...peer, role: p.role } : p)) : [...prev, peer];
      });

      await pc.setRemoteDescription(decodeSdp(encodedOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceCandidates(pc);

      if (pc.localDescription) {
        updatePeer(id, { localSdp: encodeSdp(pc.localDescription) });
      }
      return id;
    },
    [closePeerConnection, setupPeerConnection, setupDataChannel, waitForIceCandidates, updatePeer],
  );

  const send = useCallback(
    (text: string) => {
      let sent = false;
      for (const [id, conn] of connectionsRef.current) {
        if (conn.dc?.readyState === "open") {
          conn.dc.send(text);
          if (!sent) {
            addMessage({ peerId: id, from: "local", text });
            sent = true;
          }
        }
      }
      // if only one connected peer, the message was already added above
      // for multiple connected peers, we still only add one "local" message
    },
    [addMessage],
  );

  const sendTo = useCallback(
    (id: string, text: string) => {
      const conn = connectionsRef.current.get(id);
      if (conn?.dc?.readyState === "open") {
        conn.dc.send(text);
        addMessage({ peerId: id, from: "local", text });
      }
    },
    [addMessage],
  );

  const disconnectPeer = useCallback(
    (id: string) => {
      closePeerConnection(id);
      updatePeer(id, { status: "disconnected", localSdp: null });
    },
    [closePeerConnection, updatePeer],
  );

  const removePeer = useCallback(
    (id: string) => {
      closePeerConnection(id);
      setPeers((prev) => prev.filter((p) => p.id !== id));
    },
    [closePeerConnection],
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { peers, messages, createOffer, acceptOffer, acceptAnswer, send, sendTo, disconnectPeer, removePeer, clearMessages };
}
