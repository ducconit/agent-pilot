/**
 * Agent Pilot - Content Script Selector Utilities
 *
 * Pure DOM helpers that compute a unique-enough CSS selector / XPath for an element.
 * Extracted from dom-inspector.js so both the inspector and any other module can
 * reuse them without pulling in the whole inspector.
 */
(function () {
  window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};

  window.__AP_INTERNAL__.__guards = window.__AP_INTERNAL__.__guards || {};
  if (window.__AP_INTERNAL__.__guards.selectorUtils) return;
  window.__AP_INTERNAL__.__guards.selectorUtils = true;

  /**
   * Escape a single CSS identifier token (id, class) for use inside a selector.
   */
  function escapeSelectorToken(token) {
    return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(token) : String(token);
  }

  /**
   * Build a structural `tag:nth-of-type(n) > ...` path — the last-resort selector
   * used when no stable id/class combination uniquely identifies the element.
   */
  function buildStructuralPath(el) {
    const segments = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let segment = node.nodeName.toLowerCase();
      if (node.parentElement) {
        const sameTag = Array.from(node.parentElement.children).filter((c) => c.nodeName === node.nodeName);
        if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      segments.unshift(segment);
      node = node.parentElement;
    }
    return segments.join(" > ");
  }

  /**
   * Compute a CSS selector for an element, preferring a unique #id, then a unique
   * short class path, then a structural path.
   */
  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return el ? el.tagName.toLowerCase() : "";
    try {
      if (el.id) {
        const idSelector = `#${escapeSelectorToken(el.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      }

      const path = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        let selector = node.nodeName.toLowerCase();
        if (node.className && typeof node.className === "string") {
          const classes = node.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("agent-pilot"));
          if (classes.length) selector += "." + classes.slice(0, 2).map(escapeSelectorToken).join(".");
        }
        path.unshift(selector);
        node = node.parentElement;
      }

      const selector = path.join(" > ");
      if (selector && document.querySelectorAll(selector).length === 1) return selector;
    } catch (_) {}
    return buildStructuralPath(el);
  }

  /**
   * Compute an absolute XPath for an element.
   */
  function getXPath(el) {
    if (!el) return "";
    if (el.id && !el.id.includes('"')) return `//*[@id="${el.id}"]`;
    if (el === document.body) return "/html/body";

    let ix = 0;
    const siblings = el.parentNode ? el.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === el) {
        return getXPath(el.parentNode) + "/" + el.tagName.toLowerCase() + "[" + (ix + 1) + "]";
      }
      if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
        ix++;
      }
    }
    return "";
  }

  window.__AP_INTERNAL__.selectorUtils = {
    escapeSelectorToken,
    buildStructuralPath,
    getElementSelector,
    getXPath
  };
})();
