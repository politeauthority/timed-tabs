/**
 * The Rule test page: an address in, the verdict, the rules that catch it and every setting's source out.
 */
import { $, svgIcon, wildcardSpans } from "./dom.js";
import { RULE_FIELD_DEFS, fieldEmoji, formatRuleValue, ruleChipText, ruleFieldLabel } from "./rule-text.js";
import { RULE_MANAGE_FIELD, RULE_TIMING_FIELDS, RULE_VISUAL_FIELDS, applicableRules, explainSettings, isRuleableUrl, managesTab, matchesRule, patternForUrl, ruleName } from "../shared/rules.js";
import { activeGroups, openRuleEditor, ruleDrafts, rulesAppearanceOn, shownOverrides } from "./rules-list.js";
import { api } from "../shared/browser.js";
import { groupNameOf, isGroupRef } from "../shared/groups.js";
import { state } from "./state.js";

/** The address last tested, so the page comes back to it. */
export let ruleTestUrl = "";

export async function renderRuleTest() {
  const input = $("rule-test-url");
  const picker = $("rule-test-tabs");
  if (input.value !== ruleTestUrl) input.value = ruleTestUrl;
  // The open tabs, for picking one instead of typing. Extension and browser
  // pages are left out: no rule can target them.
  const tabs = await api.tabs.query({}).catch(() => []);
  picker.replaceChildren(new Option("Open tabs…", ""));
  for (const t of tabs) {
    if (!t.url || !isRuleableUrl(t.url)) continue;
    const label = (t.title || t.url).slice(0, 60);
    picker.add(new Option(label, t.url));
  }
  renderRuleTestResult();
}

export function renderRuleTestResult() {
  const out = $("rule-test-result");
  const url = ruleTestUrl.trim();
  out.replaceChildren();
  if (!url) return;
  if (!isRuleableUrl(url)) {
    const p = document.createElement("p");
    p.className = "rules-help";
    p.textContent = "That is not an address rules can target. Try a web page, starting with https://.";
    out.append(p);
    return;
  }
  const inForce = applicableRules(state.rules, url, activeGroups());
  const parked = state.rules.filter((r) => r.priority === 0 && matchesRule(r, url, activeGroups()));
  const explained = explainSettings(state.settings, inForce);
  const unmanaged = !managesTab(state.settings, inForce) || explained.manageTabs.value === false;

  // The verdict first: is this a tab Timed Tabs acts on at all, and why not.
  const verdict = document.createElement("p");
  verdict.className = "rule-test-verdict";
  verdict.classList.toggle("is-unmanaged", unmanaged);
  const why = document.createElement("small");
  if (state.settings.tabManagement === false) {
    verdict.textContent = "Left alone: Manage tabs is off for every tab.";
  } else if (explained.manageTabs.from === "rule") {
    verdict.textContent = `Left alone: “${ruleName(explained.manageTabs.rule)}” switches Manage tabs off for this address.`;
  } else if (unmanaged) {
    verdict.textContent = "Left alone: “Only manage tabs a rule matches” is on and no rule catches this address.";
  } else {
    verdict.textContent = inForce.length
      ? `Managed, with ${inForce.length} rule${inForce.length === 1 ? "" : "s"} applied.`
      : "Managed, at your defaults: no rule catches this address.";
  }
  why.textContent = unmanaged ? "No timer, nothing closed, no colours, an empty clock on the toolbar button." : "";
  if (why.textContent) verdict.append(why);
  out.append(verdict);

  // A rule for this address, started with its site filled in. The pattern is
  // the whole host, the same suggestion Add rule makes from the filter box.
  const actions = document.createElement("p");
  actions.className = "rule-test-actions";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.append(svgIcon("plus"), document.createTextNode(`Add a rule for ${patternForUrl(url)}`));
  add.title = "Start a new rule with this address's pattern filled in";
  add.addEventListener("click", () => {
    // A new rule already on the go keeps its edits; otherwise start from here.
    if (!ruleDrafts.has("new")) state.newRuleSeed = patternForUrl(url);
    openRuleEditor("new", "pattern");
  });
  actions.append(add);
  out.append(actions);

  // The rules that caught it, the one that wins first.
  const heading = document.createElement("p");
  heading.className = "rule-overrides-title";
  heading.textContent = `📋 Rules that catch this address (${inForce.length})`;
  out.append(heading);
  const list = document.createElement("div");
  list.className = "rules-list";
  for (const r of [...inForce].reverse()) list.append(renderRuleTestRule(r, false));
  for (const r of parked) list.append(renderRuleTestRule(r, true));
  if (!inForce.length && !parked.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent = "No rule matches. Add rule on the Rules page starts one from an address.";
    list.append(p);
  }
  out.append(list);

  // What every setting ends up as, and who decided.
  const th = document.createElement("p");
  th.className = "rule-overrides-title";
  th.textContent = "⚙️ What applies to this address";
  out.append(th);
  const table = document.createElement("table");
  table.className = "rule-test-table";
  const head = table.createTHead().insertRow();
  for (const t of ["Setting", "Value", "Decided by"]) {
    const cell = document.createElement("th");
    cell.textContent = t;
    head.append(cell);
  }
  const body = table.createTBody();
  // The tab's own switch has no place here: this is an address, not a tab.
  const keys = [RULE_MANAGE_FIELD, ...RULE_TIMING_FIELDS, ...(rulesAppearanceOn() ? RULE_VISUAL_FIELDS : [])];
  const layered = Object.fromEntries(keys.map((k) => [k, explained[k]?.value]));
  for (const key of keys) {
    const def = RULE_FIELD_DEFS.find((d) => d.key === key);
    // A dependent row (flash lead, favicon style) only means something while its parent is on.
    if (def?.showWhen && !def.showWhen({ ...state.settings, ...layered })) continue;
    const entry = explained[key];
    const tr = body.insertRow();
    tr.classList.toggle("is-rule", entry.from === "rule");
    const name = tr.insertCell();
    const emoji = fieldEmoji(key);
    name.textContent = `${emoji ? emoji + " " : ""}${ruleFieldLabel(key)}`;
    const value = tr.insertCell();
    value.textContent = formatRuleValue(key, entry.value);
    const from = tr.insertCell();
    if (entry.from === "rule") {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "rule-test-source";
      link.textContent = `${ruleName(entry.rule)} (${entry.rule.priority})`;
      link.title = `Open “${ruleName(entry.rule)}” at this setting`;
      link.addEventListener("click", () => openRuleEditor(entry.rule.id, key));
      from.append(link);
    } else {
      const d = document.createElement("span");
      d.className = "rule-test-default";
      d.textContent = key === RULE_MANAGE_FIELD ? "Manage tabs switch" : "Your defaults";
      from.append(d);
    }
  }
  out.append(table);
}

/** One caught rule as a row that opens its editor. `parked`: priority 0, so it did not apply. */
export function renderRuleTestRule(r, parked) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "rule-test-rule";
  el.classList.toggle("is-ignored", parked);
  el.title = "Edit this rule";
  el.addEventListener("click", () => openRuleEditor(r.id));
  const prio = document.createElement("span");
  prio.className = "rule-priority";
  prio.textContent = parked ? "off" : String(r.priority);
  const name = document.createElement("span");
  name.className = "rule-name-text";
  name.textContent = ruleName(r);
  const pattern = document.createElement("span");
  pattern.className = "rule-pattern-static";
  if (isGroupRef(r.pattern)) pattern.textContent = `🗂️ ${groupNameOf(r.pattern)}`;
  else pattern.append(...wildcardSpans(r.pattern));
  el.append(prio, name);
  if (ruleName(r) !== r.pattern) el.append(pattern);
  if (parked) {
    const note = document.createElement("span");
    note.className = "rule-meta";
    note.textContent = "matches, but is switched off";
    el.append(note);
  }
  const chips = document.createElement("span");
  chips.className = "rule-chips";
  for (const [k, v] of shownOverrides(r.set)) {
    const chip = document.createElement("span");
    chip.className = "rule-chip";
    const emoji = fieldEmoji(k);
    chip.textContent = emoji ? `${emoji} ${ruleChipText(k, v)}` : ruleChipText(k, v);
    chips.append(chip);
  }
  if (chips.childElementCount) el.append(chips);
  return el;
}

$("rule-test-url").addEventListener("input", () => {
  ruleTestUrl = $("rule-test-url").value;
  renderRuleTestResult();
});

$("rule-test-tabs").addEventListener("change", () => {
  const url = $("rule-test-tabs").value;
  if (!url) return;
  ruleTestUrl = url;
  $("rule-test-url").value = url;
  renderRuleTestResult();
});
