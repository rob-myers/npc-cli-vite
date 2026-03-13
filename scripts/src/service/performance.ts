import { info } from "@npc-cli/util/legacy/generic";

const _observer = new PerformanceObserver((list) =>
  list
    .getEntries()
    .sort((a, b) => (a.startTime + a.duration < b.startTime + b.duration ? -1 : 1))
    .forEach((entry) => info(`⏱ ${entry.name}: ${entry.duration.toFixed(2)} ms`)),
).observe({ entryTypes: ["measure"] });

const measuringLabels = /** @type {Set<string>} */ (new Set());

/**
 * Measure durations.
 */
export function perf(label: string, initMessage?: string) {
  if (measuringLabels.has(label) === false) {
    performance.mark(`${label}...`);
    measuringLabels.add(label);
    if (initMessage !== undefined) info(initMessage);
  } else {
    performance.mark(`...${label}`);
    performance.measure(label, `${label}...`, `...${label}`);
    measuringLabels.delete(label);
  }
}
