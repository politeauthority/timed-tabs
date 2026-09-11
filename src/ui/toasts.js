/**
 * Toasts: the panel's own in-page messages, drawn from the pile held in
 * `shared/toasts.js`. Everything here touches the DOM; everything about what
 * is on the pile and when it goes lives in the pure module beside it.
 *
 * These are not the desktop notifications an expiring tab raises. Those come
 * from the background through the `notifications` API and land in the
 * operating system; a toast never leaves the popup or the page it was raised
 * on, and it needs no permission.
 *
 * One host is mounted per page and is fixed to the bottom of the viewport, so
 * it sits over the content in all three contexts without being laid out by
 * them. A pointer or keyboard focus resting on the pile holds every countdown,
 * so a message cannot slip away while it is being read or while its Dismiss
 * button is being aimed at.
 */

import { createToastStore, isSticky, lifetimeOf } from "../shared/toasts.js";

/** The sprite symbol that stands for each level. */
const ICONS = {
  success: "i-check",
  info: "i-info",
  warning: "i-alert",
  error: "i-alert",
};

/** Read out before the message, so a level is not carried by colour alone. */
const LEVEL_WORDS = {
  success: "Success",
  info: "Note",
  warning: "Warning",
  error: "Error",
};

/**
 * Mount a toast host on a page and return the handle the page raises messages
 * through. Call it once.
 *
 * `show({ level, message, detail, key })` and the four level shorthands all
 * return the toast's id, or null if there was nothing to say.
 */
export function mountToasts(parent = document.body, options = {}) {
  const host = document.createElement("div");
  host.className = "toast-host";
  host.id = "toast-host";
  // A region rather than a live region: each toast carries its own role, which
  // is what gets it announced as it arrives.
  host.setAttribute("role", "region");
  host.setAttribute("aria-label", "Messages");
  parent.append(host);

  const nodes = new Map();
  let timer = null;

  const store = createToastStore({ ...options, onChange: render });

  host.addEventListener("pointerenter", () => {
    store.pause();
    schedule();
  });
  host.addEventListener("pointerleave", () => {
    store.resume();
    schedule();
  });
  host.addEventListener("focusin", () => {
    store.pause();
    schedule();
  });
  host.addEventListener("focusout", () => {
    if (host.contains(document.activeElement)) return;
    store.resume();
    schedule();
  });

  /** One timeout for the whole pile, set to whichever toast is due first. */
  function schedule() {
    clearTimeout(timer);
    timer = null;
    const due = store.nextExpiryAt();
    if (due === null) return;
    timer = setTimeout(() => {
      timer = null;
      store.expire();
      schedule();
    }, Math.max(0, due - Date.now()));
  }

  function render(list) {
    const seen = new Set();
    for (const toast of list) {
      seen.add(toast.id);
      const node = nodes.get(toast.id) ?? makeNode(toast.id);
      fill(node, toast);
      // Re-appending a node already in place is a no-op, so this also keeps
      // the pile in the store's order after one in the middle is dismissed.
      host.append(node);
    }
    for (const [id, node] of nodes) {
      if (seen.has(id)) continue;
      nodes.delete(id);
      remove(node);
    }
    host.dataset.count = String(list.length);
    schedule();
  }

  function makeNode(id) {
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.toastId = id;

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "icon toast-icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    icon.append(use);

    const body = document.createElement("div");
    body.className = "toast-body";
    const level = document.createElement("span");
    level.className = "toast-level";
    const message = document.createElement("p");
    message.className = "toast-message";
    const detail = document.createElement("p");
    detail.className = "toast-detail";
    detail.hidden = true;
    body.append(level, message, detail);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.title = "Dismiss";
    close.setAttribute("aria-label", "Dismiss");
    const closeIcon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    closeIcon.setAttribute("class", "icon");
    closeIcon.setAttribute("aria-hidden", "true");
    const closeUse = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "use",
    );
    closeUse.setAttribute("href", "#i-close");
    closeIcon.append(closeUse);
    close.append(closeIcon);
    close.addEventListener("click", () => store.dismiss(id));

    // The fuse burns down over exactly the toast's lifetime, so how long is
    // left is visible rather than guessed at. CSS pauses it with the pile.
    const fuse = document.createElement("span");
    fuse.className = "toast-fuse";
    fuse.setAttribute("aria-hidden", "true");

    node.append(icon, body, close, fuse);
    nodes.set(id, node);
    // Let the entry transition run from a standing start.
    requestAnimationFrame(() => node.classList.add("is-shown"));
    return node;
  }

  function fill(node, toast) {
    node.dataset.level = toast.level;
    // An error interrupts; everything else waits for a gap in the reading.
    node.setAttribute("role", toast.level === "error" ? "alert" : "status");
    node.querySelector(".toast-icon use").setAttribute(
      "href",
      `#${ICONS[toast.level] ?? ICONS.info}`,
    );
    node.querySelector(".toast-level").textContent = `${LEVEL_WORDS[toast.level] ?? LEVEL_WORDS.info}:`;
    node.querySelector(".toast-message").textContent = toast.message;
    const detail = node.querySelector(".toast-detail");
    detail.textContent = toast.detail;
    detail.hidden = !toast.detail;
    node.classList.toggle("is-sticky", isSticky(toast.level));

    const life = lifetimeOf(toast.level);
    const fuse = node.querySelector(".toast-fuse");
    fuse.hidden = life === 0;
    // Every toast is filled again whenever any of them changes, so the fuse is
    // only relit when this one was actually raised again: a toast taken over
    // by its key gets its full lifetime back, its neighbours keep theirs.
    const relight = node.dataset.addedAt !== String(toast.addedAt);
    node.dataset.addedAt = String(toast.addedAt);
    if (life === 0 || !relight) return;
    node.style.setProperty("--toast-life", `${life}ms`);
    fuse.classList.remove("is-burning");
    void fuse.offsetWidth;
    fuse.classList.add("is-burning");
  }

  function remove(node) {
    node.classList.remove("is-shown");
    node.classList.add("is-going");
    // Drop it once it has faded, and anyway if the transition never runs
    // (reduced motion, a hidden page) so nothing is left behind.
    const drop = () => node.remove();
    node.addEventListener("transitionend", drop, { once: true });
    setTimeout(drop, 400);
  }

  const show = (toast) => store.add(toast);
  return {
    host,
    show,
    success: (message, detail, key) =>
      show({ level: "success", message, detail, key }),
    info: (message, detail, key) =>
      show({ level: "info", message, detail, key }),
    warning: (message, detail, key) =>
      show({ level: "warning", message, detail, key }),
    error: (message, detail, key) =>
      show({ level: "error", message, detail, key }),
    dismiss: (id) => store.dismiss(id),
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
  };
}
