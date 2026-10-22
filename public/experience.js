"use strict";

// Presentation helpers deliberately keep gameplay state in app.js / the server.
window.TavernExperience = (() => {
  const markupCache = new WeakMap();
  const keyedCache = new WeakMap();
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let preferences = { motion: media.matches ? "reduced" : "full", narration: "key" };
  try {
    const saved = JSON.parse(localStorage.getItem("liars-experience") || "{}");
    if (["full", "reduced"].includes(saved.motion)) preferences.motion = saved.motion;
    if (["key", "roles", "off"].includes(saved.narration)) preferences.narration = saved.narration;
  } catch (_) { /* Storage is optional in private browsing. */ }

  function apply() {
    document.documentElement.dataset.motion = preferences.motion;
  }
  function save(next) {
    if (["full", "reduced"].includes(next.motion)) preferences.motion = next.motion;
    if (["key", "roles", "off"].includes(next.narration)) preferences.narration = next.narration;
    try { localStorage.setItem("liars-experience", JSON.stringify(preferences)); } catch (_) { /* optional */ }
    apply();
  }
  function icon(name) {
    if (!/^[a-z0-9-]+$/.test(name)) return "";
    return '<span class="ui-icon" style="--icon:url(\'/assets/icons/' + name + '.svg\')" aria-hidden="true"></span>';
  }
  function render(element, markup) {
    if (element && markupCache.get(element) !== markup) {
      element.innerHTML = markup;
      markupCache.set(element, markup);
    }
  }
  function keyed(container, items) {
    let cache = keyedCache.get(container);
    if (cache && cache.size === items.length && items.every((item, index) => {
      const entry = cache.get(String(item.key));
      return entry && entry.markup === item.markup && entry.node === container.children[index];
    })) return;
    if (!cache) {
      cache = new Map();
      keyedCache.set(container, cache);
      container.replaceChildren();
    }
    const keep = new Set();
    const positions = new Map();
    if (preferences.motion !== "reduced" && container.id === "hand-row") {
      for (const [key, item] of cache) {
        if (item.node.isConnected) positions.set(key, item.node.getBoundingClientRect());
      }
    }
    items.forEach((item, index) => {
      const key = String(item.key);
      keep.add(key);
      let entry = cache.get(key);
      if (!entry || entry.markup !== item.markup || entry.node.parentElement !== container) {
        const template = document.createElement("template");
        template.innerHTML = item.markup.trim();
        const node = template.content.firstElementChild;
        if (entry && entry.node.parentElement === container) entry.node.replaceWith(node);
        entry = { node, markup: item.markup };
        cache.set(key, entry);
      }
      const current = container.children[index];
      if (current !== entry.node) container.insertBefore(entry.node, current || null);
    });
    for (const [key, entry] of cache) {
      if (!keep.has(key)) {
        entry.node.remove();
        cache.delete(key);
      }
    }
    // Reorder retained cards without interrupting focus, selection or hover.
    if (preferences.motion !== "reduced" && container.id === "hand-row") {
      for (const [key, entry] of cache) {
        const old = positions.get(key);
        const next = entry.node.getBoundingClientRect();
        if (old && (Math.abs(old.x - next.x) > 1 || Math.abs(old.y - next.y) > 1)) {
          entry.node.animate([{ translate: (old.x - next.x) + "px " + (old.y - next.y) + "px" }, { translate: "0 0" }], {
            duration: 220, easing: "cubic-bezier(.2,.8,.2,1)"
          });
        }
      }
    }
  }
  function forget(container) {
    keyedCache.delete(container);
    markupCache.delete(container);
  }
  function accelerate(element, rate) {
    if (preferences.motion === "reduced") return;
    element.getAnimations({ subtree: true }).forEach(animation => {
      if (animation.effect && animation.effect.getTiming().iterations !== Infinity) animation.playbackRate = rate;
    });
  }
  function duration(normal, reduced) {
    return preferences.motion === "reduced" ? reduced : normal;
  }
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    image.classList.add("asset-unavailable");
    image.setAttribute("aria-hidden", "true");
    image.parentElement?.classList.add("image-fallback");
  }, true);
  apply();
  return { icon, render, keyed, forget, accelerate, duration, save, get preferences() { return { ...preferences }; } };
})();
