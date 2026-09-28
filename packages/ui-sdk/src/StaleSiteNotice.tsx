import { type BuildInfo, fetchLatestBuild, getBuildInfo } from "@npc-cli/util/build-info";
import { useEffect, useState } from "react";

/** Why a ui's chunk would not load: usually a newer deploy removed it */
export function StaleSiteNotice({ uiKey }: { uiKey: string }) {
  const ours = getBuildInfo();
  // `undefined` whilst checking, `null` if the site is unreachable
  const [latest, setLatest] = useState<BuildInfo | null>();
  useEffect(() => void fetchLatestBuild().then(setLatest), []);

  const newer = !!latest && !!ours && latest.id !== ours.id;

  return (
    <div className="flex-1 min-h-0 grid place-items-center p-4">
      <div className="flex flex-col gap-3 max-w-sm text-sm/relaxed text-white/70">
        <h2 className="text-base font-medium text-white">
          {newer ? "This page is out of date" : `Could not load ${uiKey}`}
        </h2>
        <p>
          {latest === undefined
            ? "Checking for a newer version..."
            : latest === null
              ? "Could not reach the site to check for a newer version. Are you offline?"
              : newer
                ? `A newer version of the site exists, reload to get it.`
                : "This is the latest version, so the network probably failed. Reload to retry."}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-white/40">This page</dt>
          <dd>{formatBuiltAt(ours?.at)}</dd>
          {newer && (
            <>
              <dt className="text-white/40">Latest build</dt>
              <dd>{formatBuiltAt(latest.at)}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function formatBuiltAt(at?: string) {
  const date = at ? new Date(at) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown";
}

function describeGap(from: string, to: string) {
  const hours = (new Date(to).getTime() - new Date(from).getTime()) / (60 * 60 * 1000);
  if (!Number.isFinite(hours)) return "newer";
  return hours < 1
    ? "under an hour newer"
    : hours < 48
      ? `${Math.round(hours)} hours newer`
      : `${Math.round(hours / 24)} days newer`;
}
