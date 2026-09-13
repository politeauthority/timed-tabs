/**
 * The beta note and badge: what flags are on, and the way to the switches.
 */
import { $ } from "./dom.js";
import { FIELDS } from "../shared/settings.js";
import { activeFeatures, flagOn } from "../shared/flags.js";
import { isPopup, state } from "./state.js";
import { openPageView } from "./pages.js";
import { showGroup } from "./settings-page.js";

/**
 * Say which beta features are on, and name them.
 *
 * The reason this exists is the question it answers: a flag can change the
 * popup enough that the documentation stops describing it, and there was no
 * way to tell from the screen that a switch was the cause. Naming the features
 * is the whole point, so the note lists them rather than counting them.
 *
 * Nothing is shown when none is on -- the ordinary case, which should cost no
 * space at all -- nor when "Beta features" is on by itself, since the master
 * switch changes nothing you could notice.
 */
export function renderFlagsNote() {
  const on = activeFeatures(state.settings);
  const note = $("flags-note");
  note.hidden = on.length === 0;
  if (!on.length) return;
  // Terse on purpose: this sits above everything else for as long as a flag
  // is on, and the popup has no room to spare. The names are what earn their
  // place; the reason for saying any of it waits in the tooltip.
  const names = on.map((f) => f.label);
  $("flags-note-text").textContent =
    `${names.length === 1 ? "1 beta feature" : `${names.length} beta features`} on: ${names.join(", ")}`;
  note.title =
    "Timed Tabs may not match the user guide while a beta feature is on. Settings \u2192 Feature flags.";
}

/**
 * A small "beta" pill in the header while the "Beta features" switch is on.
 *
 * The note above only speaks when a feature is actually in force, which is
 * right for a note that names things. This badge answers a different
 * question -- is this profile opted into beta at all -- so it reads the
 * master switch itself, and stays up even when nothing under it is on yet.
 * It goes to the switch, so turning it back off is one click away.
 */
export function renderBetaBadge() {
  const badge = $("beta-badge");
  const on = flagOn(state.settings, "beta-features");
  badge.hidden = !on;
  if (!on) return;
  const count = activeFeatures(state.settings).length;
  badge.title =
    (count === 0
      ? "Beta features is on, with nothing under it switched on yet."
      : `Beta features is on, with ${count === 1 ? "1 feature" : `${count} features`} in force.`) +
    " Timed Tabs may not match the user guide. Click to see the switches.";
}

/** The Settings group the flags row lives in, asked rather than assumed. */
export const FLAGS_GROUP = FIELDS.find((f) => f.key === "featureFlags")?.group;

/**
 * "Change" on the flags note goes to the switches it is talking about. From
 * the popup that means opening the page, since the flags live on the Settings
 * page and the popup has no copy of them; from a page view it is a hop, a
 * group and a scroll.
 *
 * The group is the part that is easy to miss. Settings shows one group at a
 * time and the flags have a group of their own, so on any other group the row is inside
 * a hidden section -- and `scrollIntoView` on one of those does nothing at
 * all, which lands you on Settings with no idea what you were sent to look at.
 */
/** Take the user to the feature flags: the note's "Change" and the header badge both land here. */
export function showFlagSettings() {
  // The popup has no page to scroll, so it asks the page it opens to arrive
  // on the right group, the way `site` asks the Rules page to arrive filtered.
  if (isPopup) return openPageView("#settings", FLAGS_GROUP ? { group: FLAGS_GROUP } : {});
  location.hash = "#settings";
  // After the hash has been routed and the section is displayed.
  requestAnimationFrame(() => {
    if (FLAGS_GROUP) showGroup(FLAGS_GROUP);
    $("fields")
      .querySelector('.field[data-key="featureFlags"]')
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

$("flags-note-manage").addEventListener("click", showFlagSettings);

$("beta-badge").addEventListener("click", showFlagSettings);
