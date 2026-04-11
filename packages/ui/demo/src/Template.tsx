import { WebRtcPeer } from "./webrtc/WebRtcPeer";

export default function Demo() {
  return (
    <div className="flex flex-col items-center h-full overflow-auto gap-4">
      <WebRtcPeer />
    </div>
  );
}
