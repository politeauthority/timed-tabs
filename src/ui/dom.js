/**
 * DOM helpers every section of the panel uses and none owns: element lookup,
 * sprite icons, the setting row, the switch, the slide that shows and hides a
 * governed row, the "Saved" mark, and the wildcard painter for patterns.
 * Nothing here reads shared state.
 */

export const $ = (id) => document.getElementById(id);

/** An <svg class="icon"> referencing the sprite in panel.html. */
export function svgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * Show or hide a row that another control governs, sliding it open or shut
 * rather than snapping. The first pass (`animate` false) sets the resting
 * state without motion, so a page does not open with rows sliding about.
 * The row ends with `hidden` set or cleared either way; the animation is
 * only what happens in between, and is skipped when the user asks for less
 * motion.
 */
export const SLIDE_MS = 180;

export const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function setRevealed(el, show, animate = true, onDone = null) {
  if (el.hidden === !show && !el.dataset.sliding) {
    onDone?.();
    return;
  }
  const currentAnim = el.getAnimations?.().find((a) => a.id === "slide");
  if (currentAnim) currentAnim.cancel();
  if (!animate || reduceMotion() || !el.animate) {
    delete el.dataset.sliding;
    el.hidden = !show;
    onDone?.();
    return;
  }
  el.hidden = false;
  el.dataset.sliding = "1";
  const h = `${el.scrollHeight}px`;
  const keys = [
    { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", overflow: "hidden" },
    { height: h, opacity: 1, paddingTop: getComputedStyle(el).paddingTop, paddingBottom: getComputedStyle(el).paddingBottom, overflow: "hidden" },
  ];
  const anim = el.animate(show ? keys : keys.slice().reverse(), { duration: SLIDE_MS, easing: "ease-out", id: "slide" });
  anim.onfinish = () => {
    delete el.dataset.sliding;
    el.hidden = !show;
    onDone?.();
  };
  anim.oncancel = () => {
    delete el.dataset.sliding;
  };
}

export function makeSwitch(checked, onChange) {
  const el = document.createElement("label");
  el.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const track = document.createElement("span");
  track.className = "switch-track";
  el.append(input, track);
  return { el, input };
}

/**
 * Inline confirmation on the row whose value has just been written to storage.
 *
 * A settings row says nothing, because `save` has already raised a toast
 * naming the setting. Everywhere else the tick stays: on a rule card or a
 * per-tab control it sits on the thing that changed, which a message at the
 * bottom of the window cannot do.
 */
export function markSaved(el, container = null) {
  if (!el) return;
  if ($("fields").contains(el)) return;
  // The rule editor stores nothing until Save, so a row there has nothing to confirm.
  if ($("rule-editor").contains(el)) return;
  container ??= el.querySelector(":scope > .field-control") ?? el;
  let mark = container.querySelector(":scope > .saved-mark");
  if (!mark) {
    mark = document.createElement("span");
    mark.className = "saved-mark";
    mark.setAttribute("role", "status");
    mark.textContent = "Saved";
    container.append(mark);
  }
  clearTimeout(mark._timer);
  mark.classList.remove("is-shown");
  void mark.offsetWidth; // restart the transition when saving again quickly
  mark.classList.add("is-shown");
  mark._timer = setTimeout(() => mark.classList.remove("is-shown"), 1800);
}

/**
 * Wrap a pattern input so its text is drawn by a mirror span behind it, with
 * every "*" in its own colour. An input cannot colour part of its value, so
 * the input's own text is transparent and only its caret and selection show.
 */
/** The first `max` characters of a note, with an ellipsis where it was cut. */
export function snippet(text, max) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

/** A pattern as spans, every "*" in its own so it can be coloured. */
export function wildcardSpans(pattern) {
  return pattern.split(/(\*)/).filter(Boolean).map((part) => {
    const s = document.createElement("span");
    if (part === "*") s.className = "wildcard";
    s.textContent = part;
    return s;
  });
}

export function mirrorWildcards(input) {
  const wrap = document.createElement("span");
  wrap.className = "rule-pattern-wrap";
  const mirror = document.createElement("span");
  mirror.className = "rule-pattern-mirror";
  mirror.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  mirror.append(text);
  const paint = () => {
    text.replaceChildren(...wildcardSpans(input.value));
    text.style.marginLeft = `-${input.scrollLeft}px`;
  };
  input.addEventListener("input", paint);
  input.addEventListener("scroll", paint);
  input.addEventListener("blur", paint);
  paint();
  wrap.append(mirror, input);
  return wrap;
}

export function withKey(key, row) {
  row.dataset.rowKey = key;
  return row;
}

/** A label + help on the left and a control on the right, matching the global settings rows. */
export function settingRow(labelText, helpText, control, { checkbox } = {}) {
  const row = document.createElement("div");
  row.className = "field";
  const label = document.createElement("label");
  label.className = "field-label";
  if (checkbox) label.append(checkbox, " ");
  const text = document.createElement("span");
  text.className = "field-label-text";
  text.textContent = labelText;
  label.append(text);
  if (helpText) {
    const help = document.createElement("span");
    help.className = "field-help";
    help.textContent = helpText;
    label.append(help);
  }
  const ctl = document.createElement("div");
  ctl.className = "field-control";
  if (control) {
    ctl.append(control);
    // The label element is not associated with these controls (they are
    // built apart from it), so each one that has no name yet takes the row's.
    const inputs = control.matches?.("input,select,textarea") ? [control] : [...control.querySelectorAll("input,select,textarea")];
    for (const c of inputs) {
      if (!c.hasAttribute("aria-label") && !c.id) c.setAttribute("aria-label", labelText);
    }
  }
  row.append(label, ctl);
  return row;
}
