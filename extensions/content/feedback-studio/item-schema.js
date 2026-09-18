/**
 * Agent Pilot - Feedback Item Schema Validation
 * Shared between content scripts (feedback studio), the service worker (payload guard),
 * and Node-based verification scripts. Never trust raw item objects coming from the
 * page-facing bridge: every field is coerced, whitelisted, and length-capped here.
 */
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;

  const MODES = ["element", "region", "screen", "fullpage"];
  const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
  const DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  const MAX_DATA_URL_LENGTH = 15 * 1024 * 1024;
  const MAX_COMMENT_LENGTH = 5000;
  const MAX_TITLE_LENGTH = 300;
  const MAX_TEXT_LENGTH = 500;
  const MAX_ANNOTATION_COMMENT = 1000;
  const MAX_ANNOTATIONS = 100;
  const MAX_ITEMS_PER_PAYLOAD = 50;

  function generateId() {
    return "fb_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  function clampString(value, maxLength) {
    if (typeof value !== "string") return null;
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function ensureId(value) {
    if (typeof value === "string" && ID_PATTERN.test(value)) return value;
    return generateId();
  }

  function normalizeMode(value) {
    return MODES.includes(value) ? value : "element";
  }

  function isValidDataUrl(value) {
    return typeof value === "string"
      && value.length <= MAX_DATA_URL_LENGTH
      && DATA_URL_PATTERN.test(value);
  }

  function sanitizeRect(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    for (const key of ["x", "y", "width", "height"]) {
      const num = finiteNumber(raw[key]);
      if (num === null) return null;
      out[key] = num;
    }
    return out;
  }

  function sanitizeClip(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    for (const key of ["x", "y", "width", "height"]) {
      const num = finiteNumber(raw[key]);
      if (num === null) return null;
      out[key] = num;
    }
    for (const key of ["pageX", "pageY", "scrollX", "scrollY", "pageWidth", "pageHeight", "devicePixelRatio"]) {
      const num = finiteNumber(raw[key]);
      if (num !== null) out[key] = num;
    }
    return out;
  }

  function sanitizeDom(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    const selector = clampString(raw.selector, 1000);
    const xpath = clampString(raw.xpath, 2000);
    const tagName = clampString(raw.tagName, 100);
    const text = clampString(raw.text, MAX_TEXT_LENGTH);
    const value = clampString(raw.value, 200);
    const inlineStyle = clampString(raw.inlineStyle, 2000);
    if (selector) out.selector = selector;
    if (xpath) out.xpath = xpath;
    if (tagName) out.tagName = tagName;
    if (text) out.text = text;
    if (value) out.value = value;
    if (inlineStyle) out.inlineStyle = inlineStyle;
    const rect = sanitizeRect(raw.rect);
    if (rect) out.rect = rect;
    if (raw.styles && typeof raw.styles === "object") {
      const styles = {};
      for (const key of ["color", "backgroundColor", "fontSize"]) {
        const v = clampString(raw.styles[key], 100);
        if (v) styles[key] = v;
      }
      if (Object.keys(styles).length) out.styles = styles;
    }
    return Object.keys(out).length ? out : null;
  }

  function sanitizeComponent(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    const framework = clampString(raw.framework, 50);
    const componentName = clampString(raw.componentName, 200);
    const fileName = clampString(raw.fileName, 500);
    const scopeClass = clampString(raw.scopeClass, 200);
    if (framework) out.framework = framework;
    if (componentName) out.componentName = componentName;
    if (fileName) out.fileName = fileName;
    if (scopeClass) out.scopeClass = scopeClass;
    for (const key of ["lineNumber", "columnNumber"]) {
      const num = finiteNumber(raw[key]);
      if (num !== null) out[key] = num;
    }
    if (Array.isArray(raw.hierarchy)) {
      const hierarchy = raw.hierarchy
        .map((name) => clampString(name, 200))
        .filter(Boolean)
        .slice(0, 8);
      if (hierarchy.length) out.hierarchy = hierarchy;
    } else {
      const hierarchy = clampString(raw.hierarchy, 500);
      if (hierarchy) out.hierarchy = hierarchy;
    }
    return Object.keys(out).length ? out : null;
  }

  function sanitizeAnnotations(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_ANNOTATIONS).map((annotation) => {
      if (!annotation || typeof annotation !== "object") return null;
      const out = { type: annotation.type === "box" ? "box" : "pin" };
      for (const key of ["x", "y", "width", "height"]) {
        const num = finiteNumber(annotation[key]);
        if (num !== null) out[key] = num;
      }
      out.comment = clampString(annotation.comment, MAX_ANNOTATION_COMMENT) || "";
      const id = clampString(annotation.id, 64);
      if (id && ID_PATTERN.test(id)) out.id = id;
      return out;
    }).filter(Boolean);
  }

  function validateFeedbackItem(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const item = {
      id: ensureId(source.id),
      mode: normalizeMode(source.mode),
      comment: clampString(source.comment, MAX_COMMENT_LENGTH) || "",
      timestamp: finiteNumber(source.timestamp) || Date.now()
    };

    const title = clampString(source.title, MAX_TITLE_LENGTH);
    if (title) item.title = title;

    if (isValidDataUrl(source.screenshotDataUrl)) {
      item.screenshotDataUrl = source.screenshotDataUrl;
    }

    const dom = sanitizeDom(source.dom);
    if (dom) item.dom = dom;
    const component = sanitizeComponent(source.component);
    if (component) item.component = component;
    const clip = sanitizeClip(source.clip);
    if (clip) item.clip = clip;
    const annotations = sanitizeAnnotations(source.annotations);
    if (annotations.length) item.annotations = annotations;

    return item;
  }

  function sanitizeFeedbackPayload(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const items = Array.isArray(source.items)
      ? source.items.slice(0, MAX_ITEMS_PER_PAYLOAD).map(validateFeedbackItem)
      : [];
    return {
      timestamp: finiteNumber(source.timestamp) || Date.now(),
      url: clampString(source.url, 2048) || "",
      title: clampString(source.title, 300) || "",
      items,
      prompt: clampString(source.prompt, 200000) || ""
    };
  }

  const api = {
    MODES,
    ID_PATTERN,
    MAX_ITEMS_PER_PAYLOAD,
    generateId,
    normalizeMode,
    isValidDataUrl,
    validateFeedbackItem,
    sanitizeFeedbackPayload
  };

  root.__AP_FEEDBACK_ITEM_SCHEMA__ = api;

  if (typeof window !== "undefined") {
    window.__AP_INTERNAL__ = window.__AP_INTERNAL__ || {};
    window.__AP_INTERNAL__.feedbackStudio = window.__AP_INTERNAL__.feedbackStudio || {};
    window.__AP_INTERNAL__.feedbackStudio.itemSchema = api;
  }
})();
