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

  const TEST_ID_ATTRS = [
    "data-testid",
    "data-test",
    "data-cy",
    "data-qa",
    "data-test-id",
    "data-automation-id"
  ];

  /**
   * Escape a single CSS identifier token (id, class) for use inside a selector.
   */
  function escapeSelectorToken(token) {
    return (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(token) : String(token);
  }

  /**
   * Escape a value for use inside a double-quoted CSS attribute selector `[attr="..."]`.
   */
  function escapeAttrValue(val) {
    return String(val).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /**
   * Count how many DOM elements match a CSS selector on the current document.
   */
  function getSelectorMatchCount(selector) {
    if (!selector || typeof selector !== "string") return 0;
    try {
      return document.querySelectorAll(selector).length;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Extract the highest-priority test attribute (data-testid, data-cy, data-test, etc.) on an element.
   */
  function getTestIdInfo(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return null;
    for (const attr of TEST_ID_ATTRS) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) {
        return { attr, value: val.trim() };
      }
    }
    return null;
  }

  /**
   * Build a structural `tag:nth-of-type(n) > ...` path — the last-resort selector
   * used when no stable id/class/test-attribute combination uniquely identifies the element.
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
   * Compute a CSS selector for an element, preferring:
   * 1. Unique test attribute (`[data-testid="..."]`, `[data-cy="..."]`, `[data-test="..."]`)
   * 2. Unique `#id`
   * 3. Unique semantic attribute (`name`, `aria-label`, `placeholder`)
   * 4. Shortest unique ancestor path anchored to a test attribute or `#id`
   * 5. Structural `nth-of-type` path fallback
   */
  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return el ? el.tagName.toLowerCase() : "";
    try {
      const tag = el.tagName.toLowerCase();

      // 1. Test ID attributes (best practice for QA & Automation)
      const testInfo = getTestIdInfo(el);
      if (testInfo) {
        const testSel = `[${testInfo.attr}="${escapeAttrValue(testInfo.value)}"]`;
        if (getSelectorMatchCount(testSel) === 1) return testSel;
        const tagTestSel = `${tag}${testSel}`;
        if (getSelectorMatchCount(tagTestSel) === 1) return tagTestSel;
      }

      // 2. Element ID
      if (el.id && !el.id.startsWith("agent-pilot")) {
        const idSelector = `#${escapeSelectorToken(el.id)}`;
        if (getSelectorMatchCount(idSelector) === 1) return idSelector;
      }

      // 3. Semantic attributes (name, aria-label, placeholder)
      for (const attr of ["name", "aria-label", "placeholder"]) {
        const val = el.getAttribute && el.getAttribute(attr);
        if (val && val.trim() && val.length <= 80 && !val.includes("\n")) {
          const attrSel = `${tag}[${attr}="${escapeAttrValue(val.trim())}"]`;
          if (getSelectorMatchCount(attrSel) === 1) return attrSel;
        }
      }

      // 4. Ancestor chain with early uniqueness check
      const path = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        if (node !== el) {
          const nodeTest = getTestIdInfo(node);
          if (nodeTest) {
            const anchor = `[${nodeTest.attr}="${escapeAttrValue(nodeTest.value)}"]`;
            if (getSelectorMatchCount(anchor) === 1) {
              const candidate = [anchor, ...path].join(" > ");
              if (getSelectorMatchCount(candidate) === 1) return candidate;
            }
          }
          if (node.id && !node.id.startsWith("agent-pilot")) {
            const idAnchor = `#${escapeSelectorToken(node.id)}`;
            if (getSelectorMatchCount(idAnchor) === 1) {
              const candidate = [idAnchor, ...path].join(" > ");
              if (getSelectorMatchCount(candidate) === 1) return candidate;
            }
          }
        }
        let segment = node.nodeName.toLowerCase();
        if (node.className && typeof node.className === "string") {
          const classes = node.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("agent-pilot"));
          if (classes.length) segment += "." + classes.slice(0, 2).map(escapeSelectorToken).join(".");
        }
        path.unshift(segment);
        const partial = path.join(" > ");
        if (getSelectorMatchCount(partial) === 1) return partial;
        node = node.parentElement;
      }

      const selector = path.join(" > ");
      if (selector && getSelectorMatchCount(selector) === 1) return selector;
    } catch (_) {}
    return buildStructuralPath(el);
  }

  /**
   * Compute an absolute or ID-anchored XPath for an element.
   */
  function getXPath(el) {
    if (!el || el.nodeType !== 1) return "";
    const testInfo = getTestIdInfo(el);
    if (testInfo && !testInfo.value.includes('"')) {
      const testSelector = `[${testInfo.attr}="${escapeAttrValue(testInfo.value)}"]`;
      if (getSelectorMatchCount(testSelector) === 1) {
        return `//*[@${testInfo.attr}="${testInfo.value}"]`;
      }
    }
    if (el.id && !el.id.includes('"') && !el.id.startsWith("agent-pilot")) {
      const idSelector = `#${escapeSelectorToken(el.id)}`;
      if (getSelectorMatchCount(idSelector) === 1) {
        return `//*[@id="${el.id}"]`;
      }
    }
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

  /**
   * Infer the explicit or implicit ARIA role of an element for Accessibility & Playwright locators.
   */
  function getImplicitAriaRole(el) {
    if (!el || el.nodeType !== 1) return "";
    const explicit = el.getAttribute("role");
    if (explicit && explicit.trim()) return explicit.trim();

    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "img") return "img";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "dialog") return "dialog";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "search") return "searchbox";
      if (["text", "email", "tel", "url", "password", "number"].includes(type)) return "textbox";
    }
    return "";
  }

  /**
   * Compute the accessible name of an element (aria-label, aria-labelledby, <label>, placeholder, alt, title, or text).
   */
  function getAccessibleName(el) {
    if (!el || el.nodeType !== 1) return "";
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const texts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText?.trim())
        .filter(Boolean);
      if (texts.length) return texts.join(" ");
    }

    if (el.labels && el.labels.length > 0) {
      const labelText = Array.from(el.labels)
        .map((l) => (l.innerText || l.textContent || "").trim())
        .filter(Boolean)
        .join(" ");
      if (labelText) return labelText;
    }

    for (const attr of ["alt", "placeholder", "title"]) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) return val.trim();
    }

    const tag = el.tagName.toLowerCase();
    if (["button", "a", "summary", "label", "option", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag) || el.getAttribute("role")) {
      const text = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      if (text && text.length <= 80) return text;
    }
    return "";
  }

  /**
   * Build automation-ready locators (Playwright, Test ID, ARIA Role/Name, uniqueness count).
   */
  function getTestLocators(el) {
    if (!el || el.nodeType !== 1) return null;
    const selector = getElementSelector(el);
    const xpath = getXPath(el);
    const selectorMatches = getSelectorMatchCount(selector);
    const testInfo = getTestIdInfo(el);
    const role = getImplicitAriaRole(el);
    const accessibleName = getAccessibleName(el);
    const placeholder = el.getAttribute("placeholder")?.trim() || "";

    let playwrightLocator = "";
    if (testInfo) {
      const attrSelector = `[${testInfo.attr}="${escapeAttrValue(testInfo.value)}"]`;
      if (getSelectorMatchCount(attrSelector) === 1) {
        if (testInfo.attr === "data-testid") {
          playwrightLocator = `page.getByTestId(${JSON.stringify(testInfo.value)})`;
        } else {
          playwrightLocator = `page.locator(${JSON.stringify(attrSelector)})`;
        }
      } else {
        playwrightLocator = `page.locator(${JSON.stringify(selector)})`;
      }
    } else if (role && accessibleName && accessibleName.length <= 60) {
      playwrightLocator = `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(accessibleName)} })`;
    } else if (placeholder && placeholder.length <= 60) {
      playwrightLocator = `page.getByPlaceholder(${JSON.stringify(placeholder)})`;
    } else {
      playwrightLocator = `page.locator(${JSON.stringify(selector)})`;
    }

    return {
      testId: testInfo ? testInfo.value : null,
      testIdAttr: testInfo ? testInfo.attr : null,
      role: role || null,
      accessibleName: accessibleName || null,
      playwrightLocator,
      selector,
      xpath,
      selectorMatches
    };
  }

  window.__AP_INTERNAL__.selectorUtils = {
    TEST_ID_ATTRS,
    escapeSelectorToken,
    escapeAttrValue,
    getSelectorMatchCount,
    getTestIdInfo,
    buildStructuralPath,
    getElementSelector,
    getXPath,
    getImplicitAriaRole,
    getAccessibleName,
    getTestLocators
  };
})();
