/**
 * How a rule's fields are worded: labels and help with {placeholders} for the tabs a rule matches or this tab, the chip text, and the emoji each field wears.
 */
import { FIELDS, GROUPS } from "../shared/settings.js";
import { RULE_FIELDS, RULE_MANAGE_FIELD } from "../shared/rules.js";
import { formatDuration } from "../shared/time.js";
import { indicators } from "../background/indicators/index.js";
import { parseLead } from "../shared/lead.js";

/** What a rule may override: the global field definitions, reworded for a rule. */
export const RULE_FIELD_TEXT = {
  tabLifetimeSeconds: {
    label: "Lifetime",
    help: "How long {tabs} may sit before {they} {expire}.",
  },
  onExpire: {
    label: "When a tab expires",
    short: "On expiry",
    help: "What to do with {tab} once it runs out of time in the background.",
  },
  resetOnActivate: {
    label: "Restart on focus",
    help: "Switching to {tab} gives it a full lifetime again.",
  },
  pauseWhileActive: {
    label: "Count background time only",
    short: "Background time only",
    help: "The clock stops while you are looking at {tab}.",
  },
  manageTabs: {
    label: "Manage tabs",
    short: "Managed",
    help: "Off, Timed Tabs leaves {tabs} alone: no timer, nothing closed, no colours, and an empty clock on the toolbar button. Nothing else in the rule applies.",
  },
  neverExpire: {
    label: "Timer off",
    help: "{Tabs} never {expire} and {show} no colour.",
  },
  indicators: {
    label: "Show remaining time with",
    short: "Indicators",
    help: "Only these indicators are used for {tabs}, whatever the global choice.",
  },
  faviconStyle: {
    label: "Favicon colour style",
    short: "Favicon style",
    help: "Where the colour goes on the icon of {tab}.",
  },
  hideWhileGreen: {
    label: "No display changes until",
    short: "Quiet while fresh",
    help: "Keep every indicator off on {tab} until it is close enough to expiring.",
  },
  quietStart: {
    label: "When to start display updates",
    short: "Show from",
    help: "How much time {tab} must have left before anything shows: an amount, or a share of its lifetime.",
  },
  flashBeforeExpiry: {
    label: "Flash before expiry",
    help: "{Tabs} {blink} during the last stretch before {they} {run} out of time.",
  },
  flashLead: {
    label: "Start flashing",
    help: "How much time {tab} must have left before it starts flashing: an amount, or a share of its lifetime.",
  },
};

/** Help text placeholders, worded for the tabs a rule matches. */
/**
 * Help text is written once with {placeholders} and read in two places: a
 * rule, which speaks about every page it matches, and Page settings, which
 * speaks about the tab in front of you.
 */
export const SUBJECT = { tabs: "matching tabs", Tabs: "Matching tabs", tab: "a matching tab", they: "they", expire: "expire", show: "show", blink: "blink", run: "run" };

export const THIS_TAB_SUBJECT = { tabs: "this tab", Tabs: "This tab", tab: "this tab", they: "it", expire: "expires", show: "shows", blink: "blinks", run: "runs" };

export const wordFor = (text, subject = SUBJECT) =>
  text.replace(/\{(\w+)\}/g, (_, k) => subject[k] ?? k);

export const RULE_FIELD_DEFS = RULE_FIELDS.map((key) => {
  const base = FIELDS.find((f) => f.key === key) ?? { key, type: "toggle" };
  return { ...base, ...RULE_FIELD_TEXT[key] };
});

export const defsFor = (keys, subject = SUBJECT) =>
  keys
    .map((k) => RULE_FIELD_DEFS.find((d) => d.key === k))
    .map((d) => ({ ...d, help: wordFor(d.help ?? "", subject) }));

/**
 * A toggle override worded for a chip. A chip has no room for "Timer off: on",
 * so both readings are written out; every other type reads well enough as
 * "Label: value" and falls through to `ruleFieldLabel`.
 */
export const RULE_CHIP_TOGGLE_TEXT = {
  resetOnActivate: { on: "Restarts on focus", off: "No restart on focus" },
  pauseWhileActive: { on: "Background time only", off: "Counts time while active" },
  neverExpire: { on: "Timer off", off: "Timer on" },
  manageTabs: { on: "Managed", off: "Left alone" },
  hideWhileGreen: { on: "Quiet until near expiry", off: "Shows from the start" },
  flashBeforeExpiry: { on: "Flashes before expiry", off: "No flash" },
};

/** Field labels that are sentences; a chip has no room for them. */
export const RULE_CHIP_LABEL = {
  onExpire: "On expiry",
  indicators: "Shows with",
  faviconStyle: "Favicon",
  quietStart: "Shows from",
  flashLead: "Flashes from",
};

export function ruleChipText(key, value) {
  const pair = RULE_CHIP_TOGGLE_TEXT[key];
  if (pair) return value ? pair.on : pair.off;
  const label = RULE_CHIP_LABEL[key] ?? ruleFieldLabel(key);
  return `${label}: ${formatRuleValue(key, value)}`;
}

/**
 * The emoji of the settings group a rule field belongs to, so a rule's chips
 * and its override headings read like the Settings page: ⏳ for timing, 🚪 for
 * expiry, 🎨 for appearance. The rule-only timer switch counts as timing.
 */
export function fieldEmoji(key) {
  const def = RULE_FIELD_DEFS.find((f) => f.key === key);
  const group = def?.group ?? (key === "neverExpire" ? "timing" : key === RULE_MANAGE_FIELD ? "general" : "appearance");
  return GROUPS.find((g) => g.id === group)?.emoji ?? "";
}

export function ruleFieldLabel(key) {
  return RULE_FIELD_DEFS.find((f) => f.key === key)?.label ?? key;
}

/** A lead in words: "10 min left" or "40% of the lifetime left". */
export function leadText(v) {
  const lead = parseLead(v);
  if (!lead) return String(v);
  return "percent" in lead ? `${lead.percent}% of the lifetime left` : `${formatDuration(lead.seconds)} left`;
}

export function formatRuleValue(key, v) {
  const def = RULE_FIELD_DEFS.find((f) => f.key === key);
  if (def?.type === "duration") return formatDuration(v);
  if (def?.type === "choice")
    return def.options.find((o) => o.value === v)?.label ?? String(v);
  if (def?.type === "percent") return `${v}%`;
  if (def?.type === "lead") return leadText(v);
  if (def?.type === "indicators") {
    const names = (Array.isArray(v) ? v : []).map((id) => indicators.find((i) => i.id === id)?.label ?? id);
    return names.length ? names.join(", ") : "nothing";
  }
  return v ? "on" : "off";
}

export function describeRule(r) {
  const parts = Object.entries(r.set ?? {}).map(
    ([k, v]) => `${ruleFieldLabel(k)}: ${formatRuleValue(k, v)}`,
  );
  return parts.length ? parts.join("\n") : "Sets nothing";
}
