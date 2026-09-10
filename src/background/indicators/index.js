/**
 * Indicator strategy registry.
 *
 * An indicator receives tab progress values and makes them visible to the
 * user somehow. Any number may run at once, chosen by the `indicators`
 * setting. Each strategy exports:
 *
 *   {
 *     id: "theme-tint",
 *     label: "Tint the active tab",
 *     supported(): boolean,            // can this run in the current browser?
 *     start(ctx): Promise<void>,       // ctx: { api, tracker, settings }
 *     configure?(settings): void,      // optional: settings changed while running
 *     update(tabs): Promise<void>,     // tabs: [{ tabId, windowId, url, status, discarded,
 *                                      //          active, exempt, quiet, progress, remainingSeconds }]
 *                                      // quiet: show nothing for this tab (user setting)
 *     stop(): Promise<void>,           // must undo any visible changes
 *   }
 */
import * as favicon from "./favicon.js";
import * as themeTint from "./theme-tint.js";
import * as badge from "./badge.js";
import * as titlePrefix from "./title-prefix.js";

export const indicators = [favicon, titlePrefix, themeTint, badge];

export function findIndicators(ids) {
  return indicators.filter((i) => ids.includes(i.id) && i.supported());
}
