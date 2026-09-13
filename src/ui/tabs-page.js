/**
 * The Tabs page: every open tab by window, the recently expired list and the statistics fold.
 */
import { $, svgIcon } from "./dom.js";
import { TAB_SORTS, sortTabs } from "../shared/tab-sort.js";
import { api } from "../shared/browser.js";
import { describeRule } from "./rule-text.js";
import { featureOn } from "../shared/flags.js";
import { formatRemaining, formatSpan } from "../shared/time.js";
import { groupRecent } from "../shared/recent.js";
import { hooks } from "./hooks.js";
import { isPopup, state } from "./state.js";
import { rememberFold } from "./folds.js";
import { ruleName } from "../shared/rules.js";
import { save } from "./settings-page.js";
import { snoozeFor } from "./popup.js";

export let overviewTimer = null;

export let overviewSeq = 0;

export async function refreshOverview() {
  const seq = ++overviewSeq;
  const groups = await api.runtime
    .sendMessage({ type: "timed-tabs:all-tabs" })
    .catch(() => []);
  const list = $("overview-list");
  // A slower earlier request must not paint over a newer one, and a rebuild
  // must not pull an armed Close or a focused control out from under the user.
  if (seq !== overviewSeq) return;
  if (list.querySelector(".is-armed") || list.contains(document.activeElement)) return;
  const total = groups.reduce((n, g) => n + g.tabs.length, 0);
  const open = groups.reduce((n, g) => n + (g.total ?? g.tabs.length), 0);
  const count = $("overview-count");
  count.textContent = open ? countLabel(total, open) : "";
  count.title = total === open ? "" : heldBackLabel(open - total);
  if (!total) {
    const empty = document.createElement("p");
    empty.className = "overview-empty";
    empty.textContent = open
      ? `Every open tab expired more than ${formatSpan(state.settings.expiredGraceSeconds)} ago. They are under "Recently expired".`
      : "No tabs are being timed.";
    list.replaceChildren(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  groups.forEach((g, i) => {
    // Order within each window; the windows themselves keep their own order.
    const rows = sortTabs(g.tabs, state.settings.tabSort).map(renderTabRow);
    if (groups.length === 1) {
      frag.append(...rows);
      return;
    }
    const group = document.createElement("details");
    group.className = "window-group";
    const sum = document.createElement("summary");
    sum.className = "window-title chev";
    const name = document.createElement("span");
    name.className = "window-name";
    name.textContent = g.focused ? "Active window" : `Window ${i + 1}`;
    const count = document.createElement("span");
    count.className = "overview-count";
    const inWindow = g.total ?? g.tabs.length;
    count.textContent = countLabel(g.tabs.length, inWindow);
    count.title = g.tabs.length === inWindow ? "" : heldBackLabel(inWindow - g.tabs.length);
    sum.append(name, count);
    group.append(sum, ...rows);
    rememberFold(group, `window-${i}`, true);
    frag.append(group);
  });
  list.replaceChildren(frag);
}

/**
 * "6 tabs", or "2 of 8 tabs" where some are held back. Both numbers, because
 * neither on its own is honest: the window really does hold eight tabs, and
 * the list really does show two of them.
 */
export function countLabel(shown, total) {
  const word = `tab${total === 1 ? "" : "s"}`;
  return shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
}

export function heldBackLabel(n) {
  return `${n} expired more than ${formatSpan(state.settings.expiredGraceSeconds)} ago and ${n === 1 ? "is" : "are"} under "Recently expired"`;
}

export function renderTabRow(t) {
  const row = document.createElement("div");
  row.className = "trow";
  const timerOff = t.effective?.neverExpire ?? t.neverExpire;
  const exempt = timerOff || t.pinned || t.unmanaged;
  if (t.active) row.classList.add("is-active");
  if (exempt) row.classList.add("is-off");
  if (!exempt && t.progress >= 1) {
    row.classList.add("is-expired");
    row.title = "Expired";
  }

  const icon = document.createElement("img");
  icon.className = "trow-icon";
  icon.alt = "";
  if (t.favIconUrl) icon.src = t.favIconUrl;
  row.append(icon);

  const title = document.createElement("button");
  title.type = "button";
  title.className = "trow-title";
  title.textContent = t.title;
  title.title = t.url ?? "";
  title.addEventListener("click", () => {
    api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "focus",
      })
      .catch(() => {});
    if (isPopup) window.close();
    else setTimeout(hooks.refreshOverview, 300);
  });
  row.append(title);

  if (t.rules?.length) {
    const tag = document.createElement("span");
    tag.className = "trow-rules";
    if (t.ignoreRules) tag.classList.add("is-ignored");
    tag.textContent =
      (t.rules.length === 1 ? "1 rule" : `${t.rules.length} rules`) +
      (t.ignoreRules ? " ignored" : "");
    tag.title = [...t.rules]
      .reverse()
      .map(
        (r) =>
          `${ruleName(r) !== r.pattern ? ruleName(r) + " — " : ""}${r.pattern} (${r.priority})\n${describeRule(r)}`,
      )
      .join("\n\n");
    row.append(tag);
  }

  const time = document.createElement("span");
  time.className = "trow-time";
  if (t.unmanaged) {
    time.textContent = "no rule";
    time.title = "Only manage tabs a rule matches is on, and no rule matches this page";
  } else if (t.pinned) time.textContent = "pinned";
  else if (timerOff)
    time.textContent = t.neverExpire ? "timer off" : "timer off (rule)";
  else if (t.paused)
    time.textContent = `${formatRemaining(t.remainingSeconds)} · paused`;
  else time.textContent = formatRemaining(t.remainingSeconds);
  row.append(time);

  const fuse = document.createElement("div");
  fuse.className = "trow-fuse";
  fuse.style.setProperty(
    "--pct",
    `${exempt ? 0 : Math.round(t.progress * 100)}%`,
  );
  row.append(fuse);

  // Snooze: the one row control that acts instead of toggling, so it says how
  // much it grants rather than whether it is on.
  const snooze = quickToggle(
    "plus",
    false,
    false,
    exempt
      ? "This tab has no timer to snooze"
      : `Snooze: adds ${formatRemaining(snoozeFor(t))}`,
    "qtoggle-snooze",
  );
  snooze.disabled = exempt;
  snooze.removeAttribute("aria-pressed");
  snooze.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "snooze",
      })
      .catch(() => {});
    hooks.refreshOverview();
    if (state.currentTab?.id === t.tabId) hooks.refreshTab();
  });
  row.append(snooze);

  const timer = quickToggle(
    "timer",
    !t.neverExpire,
    false,
    t.neverExpire ? "Timer is off. Turn on" : "Timer is on. Turn off",
    "qtoggle-timer",
  );
  timer.disabled = t.pinned;
  timer.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "neverExpire",
        value: !t.neverExpire,
      })
      .catch(() => {});
    hooks.refreshOverview();
    if (state.currentTab?.id === t.tabId) hooks.refreshTab();
  });
  row.append(timer);

  const effective = t.resetOnActivate ?? state.settings.resetOnActivate;
  const inherited =
    t.resetOnActivate === null || t.resetOnActivate === undefined;
  const focus = quickToggle(
    "restart",
    effective,
    inherited,
    (effective ? "Restarts on focus" : "Keeps counting on focus") +
      (inherited ? " (default)" : "") +
      ". Click to change",
    "qtoggle-focus",
  );
  focus.addEventListener("click", async () => {
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "resetOnActivate",
        value: !effective,
      })
      .catch(() => {});
    hooks.refreshOverview();
  });
  row.append(focus);

  // Close the tab: two clicks within a few seconds, the first only arms it.
  const close = quickToggle(
    "close",
    false,
    false,
    "Close this tab",
    "qtoggle-close",
  );
  close.removeAttribute("aria-pressed"); // a plain button, not a toggle
  let armed = null;
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    close.classList.remove("is-armed");
    close.replaceChildren(svgIcon("close"));
    close.title = "Close this tab";
    close.setAttribute("aria-label", "Close this tab");
  };
  close.addEventListener("click", async () => {
    if (!armed) {
      close.classList.add("is-armed");
      close.replaceChildren(
        svgIcon("close"),
        document.createTextNode("Close?"),
      );
      close.title = "Click again to close this tab";
      close.setAttribute("aria-label", "Click again to close this tab");
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    await api.runtime
      .sendMessage({
        type: "timed-tabs:tab-action",
        tabId: t.tabId,
        action: "close",
      })
      .catch(() => {});
    hooks.refreshOverview();
    if (isPopup && state.currentTab?.id === t.tabId) window.close();
  });
  close.addEventListener("blur", () => {
    if (armed) setTimeout(disarm, 200);
  });
  row.append(close);
  return row;
}

export function quickToggle(iconName, pressed, inherited, label, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `qtoggle ${cls}`;
  if (inherited) b.classList.add("is-inherited");
  b.replaceChildren(svgIcon(iconName));
  b.setAttribute("aria-pressed", String(Boolean(pressed)));
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

export function renderSortControl() {
  const select = $("overview-sort");
  if (select.options.length !== TAB_SORTS.length) {
    select.replaceChildren(
      ...TAB_SORTS.map((o) => new Option(o.label, o.id)),
    );
  }
  select.value = state.settings.tabSort;
}

// `save` persists the choice and redraws the list, so the order survives a
// reload and follows the profile.
$("overview-sort").addEventListener("change", (e) =>
  save({ tabSort: e.target.value }),
);

$("overview").addEventListener("toggle", (e) => {
  clearInterval(overviewTimer);
  overviewTimer = null;
  if (e.target.open) {
    hooks.refreshOverview();
    overviewTimer = setInterval(hooks.refreshOverview, 5000);
  }
});

export async function refreshRecent() {
  const list = await api.runtime
    .sendMessage({ type: "timed-tabs:recent" })
    .catch(() => []);
  $("recent-count").textContent = list.length ? String(list.length) : "";
  const root = $("recent-list");
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "overview-empty";
    p.textContent = "No tabs have expired yet.";
    root.replaceChildren(p);
    return;
  }
  // One row per address; a page that keeps expiring shows a count instead of a pile of rows.
  root.replaceChildren(...groupRecent(list).map(renderRecentRow));
}

export function renderRecentRow(item) {
  const row = document.createElement("div");
  row.className = "trow";
  const icon = document.createElement("img");
  icon.className = "trow-icon";
  icon.alt = "";
  if (item.favIconUrl) icon.src = item.favIconUrl;
  const title = document.createElement("span");
  title.className = "trow-title";
  title.textContent = item.title || item.url;
  // "closed" only where we closed it. A tab left open when it expired is
  // listed here too, and calling that closed would send the user looking for a
  // tab that never went anywhere.
  const verb = item.action === "close" ? "closed" : "expired";
  const when = document.createElement("span");
  when.className = "trow-when";
  if (item.count > 1) {
    const count = document.createElement("span");
    count.className = "trow-count";
    count.textContent = `×${item.count}`;
    count.title = `${verb === "closed" ? "Closed" : "Expired"} ${item.count} times`;
    when.append(count, `last ${verb} ${timeAgo(item.expiredAt)}`);
  } else {
    when.textContent = `${verb} ${timeAgo(item.expiredAt)}`;
  }
  const url = document.createElement("span");
  url.className = "trow-url";
  url.textContent = item.url;
  url.title = item.url;
  // The tab this row names may still be open -- expiring does not always close
  // one -- and then there is nothing to reopen: take the user to it instead,
  // rather than leaving them a second copy of a page they already have.
  const reopen = document.createElement("button");
  reopen.type = "button";
  reopen.className = "trow-reopen";
  reopen.append(
    svgIcon(item.open ? "tabs" : "reopen"),
    document.createTextNode(item.open ? "Go to tab" : "Reopen"),
  );
  reopen.title = item.open
    ? "This tab is still open; go to it"
    : "Open this address in a new tab";
  reopen.addEventListener("click", async () => {
    await api.runtime
      .sendMessage(
        item.open
          ? { type: "timed-tabs:tab-action", tabId: item.tabId, action: "focus" }
          : { type: "timed-tabs:recent-reopen", url: item.url },
      )
      .catch(() => {});
    if (isPopup) window.close();
    else setTimeout(refreshRecent, 300);
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "qtoggle trow-remove";
  remove.replaceChildren(svgIcon("close"));
  const removeLabel = item.count > 1 ? `Remove all ${item.count} from this list` : "Remove from this list";
  remove.title = removeLabel;
  remove.setAttribute("aria-label", removeLabel);
  remove.addEventListener("click", async () => {
    row.remove();
    await api.runtime
      .sendMessage({ type: "timed-tabs:recent-remove", ids: item.ids ?? [item.id] })
      .catch(() => {});
    refreshRecent();
  });
  row.append(icon, title, when, url, reopen, remove);
  return row;
}

export function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const statsOn = () => featureOn(state.settings, "statistics-panel");

/**
 * Show or hide the whole section, which is all the flag does.
 *
 * The counting is not gated and must not be: the background tallies whatever
 * the flag says, so turning it on shows everything that happened while it was
 * off rather than starting from nothing. What the flag decides is whether
 * there is anything here to read.
 *
 * Hiding empties the body too. A `hidden` section keeps its DOM, and leaving
 * the last numbers sitting in it means they are still in the page for anything
 * that reads the document -- and would be what the user saw for an instant on
 * turning the flag back on, before the refresh landed.
 */
export function renderStats() {
  const section = $("stats");
  if (!section) return;
  section.hidden = !statsOn();
  if (section.hidden) {
    $("stats-headline").textContent = "";
    $("stats-body").replaceChildren();
    return;
  }
  if (section.open) refreshStats();
}

/**
 * The tally, as tiles and a small chart.
 *
 * Deliberately the plainest rendering in the panel: `summarise` has already
 * decided what every number means, so there is nothing to work out here beyond
 * where to put it. The legend above it earns its place — this is the one list
 * on the page that keeps nothing about any particular tab, and next to
 * "Recently expired", which keeps rather a lot, that is worth saying.
 */
export async function refreshStats() {
  // Belt and braces: every caller checks, but the section is polled on a timer
  // and asked to refresh from a few places, and a flag that is off should cost
  // the background no messages at all.
  if (!statsOn()) return;
  const s = await api.runtime.sendMessage({ type: "timed-tabs:stats" }).catch(() => null);
  const body = $("stats-body");
  const headline = $("stats-headline");
  if (!s) {
    headline.textContent = "";
    body.replaceChildren(statsEmpty("Statistics are not available right now."));
    return;
  }
  headline.textContent = s.expired ? s.expired.toLocaleString() : "";
  if (s.empty) {
    body.replaceChildren(statsEmpty("Nothing to count yet. Once a tab runs out of time, this fills in."));
    return;
  }

  const frag = document.createDocumentFragment();
  // The headline and the chart are both about expiries, so both wait until
  // there has been one. Snoozing a tab on your first day should not be met
  // with a bold zero and fourteen empty columns.
  if (s.expired > 0) frag.append(statsHeadline(s), statsChart(s));
  frag.append(statsTiles(s));
  body.replaceChildren(frag);
}

export function statsEmpty(text) {
  const p = document.createElement("p");
  p.className = "overview-empty";
  p.textContent = text;
  return p;
}

/** The one number this whole section is about, and what it is made of. */
export function statsHeadline(s) {
  const wrap = document.createElement("div");
  wrap.className = "stats-headline";

  const big = document.createElement("p");
  big.className = "stats-big";
  const n = document.createElement("span");
  n.className = "stats-big-number";
  n.textContent = s.expired.toLocaleString();
  const label = document.createElement("span");
  label.className = "stats-big-label";
  label.textContent = s.expired === 1 ? "tab seen off" : "tabs seen off";
  big.append(n, label);

  const parts = [
    [s.closed, "closed"],
    [s.discarded, "unloaded"],
    [s.reloaded, "reloaded"],
  ].filter(([count]) => count > 0);
  wrap.append(big);
  // Only worth a line when it says something the headline did not: one kind of
  // expiry on its own is already the number above.
  if (parts.length > 1) {
    const sub = document.createElement("p");
    sub.className = "stats-sub";
    sub.textContent = parts.map(([count, word]) => `${count.toLocaleString()} ${word}`).join(" · ");
    wrap.append(sub);
  }
  return wrap;
}

/**
 * Expiries per day, oldest on the left. `summarise` returns every day in the
 * window including the empty ones, so the gaps in the chart are real gaps.
 *
 * Drawn rather than charted: a run of `<div>`s with a height each, which needs
 * no library and takes the theme's colours for nothing.
 */
export function statsChart(s) {
  const wrap = document.createElement("figure");
  wrap.className = "stats-chart";

  const peak = Math.max(1, ...s.days.map((d) => d.count));
  const bars = document.createElement("div");
  bars.className = "stats-bars";
  for (const day of s.days) {
    const bar = document.createElement("div");
    bar.className = "stats-bar";
    // A day with nothing in it keeps a sliver, so the run of days stays legible
    // as a run of days rather than becoming a gap in the middle of the chart.
    bar.style.setProperty("--h", day.count ? `${Math.max(8, (day.count / peak) * 100)}%` : "2px");
    if (!day.count) bar.classList.add("is-empty");
    bar.title = `${formatDay(day.date)}: ${day.count} ${day.count === 1 ? "tab" : "tabs"}`;
    bars.append(bar);
  }

  const caption = document.createElement("figcaption");
  caption.className = "stats-caption";
  caption.textContent = `Last ${s.days.length} days · busiest ${
    s.busiest ? `${formatDay(s.busiest.date)} with ${s.busiest.count}` : "day yet to come"
  }`;

  wrap.append(bars, caption);
  return wrap;
}

/** The rest of it, one tile each; a tile with nothing to say is left out. */
export function statsTiles(s) {
  const tiles = [
    // First because it is the one that lasts: a clear leaves it, and a backup
    // carries it, so after either it may be the only tile here.
    s.killed && {
      value: s.killed.toLocaleString(),
      label: s.killed === 1 ? "tab killed, all time" : "tabs killed, all time",
      note: "kept through a clear and in backups",
    },
    s.snoozes && {
      value: s.snoozes.toLocaleString(),
      label: s.snoozes === 1 ? "snooze" : "snoozes",
      note: s.snoozeSeconds ? `${formatSpan(s.snoozeSeconds)} bought` : "",
    },
    s.resets && {
      value: s.resets.toLocaleString(),
      label: s.resets === 1 ? "timer restarted" : "timers restarted",
    },
    s.peakTabs && {
      value: s.peakTabs.toLocaleString(),
      label: "tabs at once, at most",
      note: s.peakAt ? formatDay(dayKeyOf(s.peakAt)) : "",
    },
    s.expired && {
      value: s.perDay >= 10 ? Math.round(s.perDay).toLocaleString() : s.perDay.toFixed(1),
      label: "a day, on average",
      note: `over ${s.daysTracked} ${s.daysTracked === 1 ? "day" : "days"}`,
    },
  ].filter(Boolean);

  const grid = document.createElement("div");
  grid.className = "stats-tiles";
  for (const t of tiles) {
    const tile = document.createElement("div");
    tile.className = "stats-tile";
    const value = document.createElement("span");
    value.className = "stats-tile-value";
    value.textContent = t.value;
    const label = document.createElement("span");
    label.className = "stats-tile-label";
    label.textContent = t.label;
    tile.append(value, label);
    if (t.note) {
      const note = document.createElement("span");
      note.className = "stats-tile-note";
      note.textContent = t.note;
      tile.append(note);
    }
    grid.append(tile);
  }
  return grid;
}

/** "11 Sep" from a "YYYY-MM-DD" key, in the reader's own locale. */
export function formatDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The local day an epoch stamp fell on, so a date reads the way the chart does. */
export function dayKeyOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

$("stats").addEventListener("toggle", (e) => {
  if (e.target.open) refreshStats();
});

$("stats-clear").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "timed-tabs:stats-clear" }).catch(() => {});
  refreshStats();
});

export let recentTimer = null;

$("recent").addEventListener("toggle", (e) => {
  if (e.target.open) refreshRecent();
});

$("recent-clear").addEventListener("click", async () => {
  await api.runtime
    .sendMessage({ type: "timed-tabs:recent-clear" })
    .catch(() => {});
  refreshRecent();
});

/** The Tabs page is on screen: refresh what is open and keep it fresh. */
export function startTabsPage() {
  if ($("overview").open) {
    hooks.refreshOverview();
    overviewTimer = setInterval(hooks.refreshOverview, 5000);
  }
  if ($("recent").open) refreshRecent();
  if (statsOn() && $("stats").open) refreshStats();
  // Recent list keeps itself fresh while the page is open; the tally rides
  // along on the same beat, since it moves for the same reasons.
  recentTimer = setInterval(() => {
    if ($("recent").open) refreshRecent();
    if (statsOn() && $("stats").open) refreshStats();
  }, 15000);
}

/** The tab lists poll the background; only while they are on screen. */
export function stopTabsPage() {
  clearInterval(overviewTimer);
  overviewTimer = null;
  clearInterval(recentTimer);
  recentTimer = null;
}
