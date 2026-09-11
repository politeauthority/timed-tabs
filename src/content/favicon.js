/**
 * Content script for the "favicon" indicator.
 *
 * Replaces the page's favicon with a canvas rendering: a rounded square in
 * the ramp colour with the original icon on top. Inactive tabs are drawn
 * semi-transparent so the tab strip shows through and they read dimmer.
 * Restores the original favicon on "reset".
 */
(() => {
  if (globalThis.__timedTabsFavicon) return;
  globalThis.__timedTabsFavicon = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const SIZE = 32;

  let originalLinks = null; // [{ el, href }]
  let originalHref = null;
  let iconImage = null; // HTMLImageElement | null | "failed"
  let ourLink = null;

  let blinkTimer = null;
  let blinkOn = true;

  api.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "timed-tabs:favicon") {
      const r = render(msg);
      setBlink(Boolean(msg.flash), msg);
      return Promise.resolve(r);
    }
    if (msg.type === "timed-tabs:reset") {
      setBlink(false);
      restore();
      return Promise.resolve("favicon:reset");
    }
    // The background asks before closing an expired tab, so its "recently
    // expired" entry can show the site's icon rather than our painted one.
    if (msg.type === "timed-tabs:original-icon") {
      captureOriginal();
      return Promise.resolve(originalHref ?? "");
    }
    // Not ours: say nothing, so the script the message was for can be
    // injected if it is missing (see background/indicators/inject.js).
    return undefined;
  });

  // About to expire: alternate the painted icon with the site's plain one.
  function setBlink(on, msg) {
    if (!on) {
      if (blinkTimer) clearInterval(blinkTimer);
      blinkTimer = null;
      blinkOn = true;
      return;
    }
    if (blinkTimer) return;
    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      if (blinkOn) render(lastMsg ?? msg);
      else if (originalHref) setFavicon(originalHref);
    }, 700);
  }

  function captureOriginal() {
    if (originalLinks) return;
    // A previous instance of this script (extension reload) may have left its
    // own link behind; recover the real original from it instead of adopting
    // our own data: URL as the "original".
    const stale = document.querySelector("link[data-timed-tabs-original]");
    if (stale) {
      originalHref = stale.dataset.timedTabsOriginal;
      stale.remove();
      originalLinks = [];
      return;
    }
    originalLinks = [...document.querySelectorAll('link[rel~="icon"]')].map((el) => ({
      el,
      href: el.href,
    }));
    originalHref = originalLinks.find((l) => l.href)?.href ?? new URL("/favicon.ico", location.href).href;
  }

  function loadIcon() {
    if (iconImage !== null) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      iconImage = img;
      if (lastMsg) render(lastMsg);
    };
    img.onerror = () => {
      iconImage = "failed";
    };
    img.src = originalHref;
    iconImage = img; // may not be complete yet
  }

  let lastMsg = null;
  function render(msg) {
    lastMsg = msg;
    captureOriginal();
    loadIcon();

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    const alpha = msg.active ? 1 : 0.6;
    const style = msg.style ?? "square";
    const haveIcon = Boolean(iconImage && iconImage !== "failed" && iconImage.complete && iconImage.naturalWidth);

    // Where the original icon goes for each style.
    const iconBox = {
      square: [SIZE * 0.18, SIZE * 0.18, SIZE * 0.64],
      ring: [SIZE * 0.2, SIZE * 0.2, SIZE * 0.6],
      dot: [0, 0, SIZE],
    }[style] ?? [SIZE * 0.18, SIZE * 0.18, SIZE * 0.64];

    const paintMark = () => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = msg.color;
      ctx.strokeStyle = msg.color;
      if (style === "ring") {
        ctx.lineWidth = SIZE * 0.14;
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (style === "dot") {
        const r = SIZE * 0.2;
        ctx.beginPath();
        ctx.arc(SIZE - r - 1, SIZE - r - 1, r, 0, Math.PI * 2);
        ctx.fill();
        // Thin outline so the dot stays visible on same-coloured icons.
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = msg.textColor ?? "#000";
        ctx.stroke();
      } else {
        roundRect(ctx, 0, 0, SIZE, SIZE, 7);
        ctx.fill();
      }
      ctx.restore();
    };

    const paintIcon = () => {
      const [x, y, w] = iconBox;
      ctx.drawImage(iconImage, x, y, w, w);
      canvas.toDataURL(); // throws if the canvas got tainted
    };

    const paintLetter = () => {
      const [x, y, w] = iconBox;
      ctx.fillStyle = msg.textColor ?? "#000";
      ctx.font = `bold ${w * 0.9}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((location.hostname.replace(/^www\./, "")[0] ?? "?").toUpperCase(), x + w / 2, y + w / 2 + 1);
    };

    let drewIcon = false;
    // Square and ring go behind/around the icon; the dot goes on top.
    if (style !== "dot") paintMark();
    if (haveIcon) {
      try {
        paintIcon();
        drewIcon = true;
      } catch {
        ctx.clearRect(0, 0, SIZE, SIZE);
        if (style !== "dot") paintMark();
      }
    }
    if (!drewIcon) paintLetter();
    if (style === "dot") paintMark();

    setFavicon(canvas.toDataURL("image/png"));
    return drewIcon ? "icon" : "letter";
  }

  let observer = null;
  let lastHref = null;

  function setFavicon(href) {
    lastHref = href;
    for (const { el } of originalLinks) el.remove();
    if (!ourLink) {
      ourLink = document.createElement("link");
      ourLink.rel = "icon";
      ourLink.type = "image/png";
      ourLink.sizes = "32x32";
      ourLink.dataset.timedTabsOriginal = originalHref;
    }
    ourLink.href = href;
    // Ours must be the last icon link in <head> for Firefox to prefer it.
    if (ourLink !== document.head.lastElementChild || !ourLink.isConnected) {
      document.head.appendChild(ourLink);
    }
    watchHead();
  }

  // Sites (Reddit, YouTube, Google, ...) re-insert their own icon links after
  // load, which would displace ours. Remove any that appear and keep ours last.
  function watchHead() {
    if (observer) return;
    observer = new MutationObserver((records) => {
      let dirty = false;
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node !== ourLink && node.nodeType === 1 && node.matches?.('link[rel~="icon"]')) {
            originalLinks.push({ el: node, href: node.href });
            node.remove();
            dirty = true;
          }
        }
        if ([...r.removedNodes].includes(ourLink)) dirty = true;
      }
      if (dirty && lastHref) {
        observer.disconnect();
        observer = null;
        setFavicon(lastHref);
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });
  }

  function restore() {
    if (!originalLinks) return;
    observer?.disconnect();
    observer = null;
    lastHref = null;
    ourLink?.remove();
    ourLink = null;
    for (const { el } of originalLinks) document.head.appendChild(el);
    if (!originalLinks.length) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = originalHref;
      document.head.appendChild(link);
    }
    originalLinks = null;
    lastMsg = null;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
})();
