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
    const playwrightLocator = clampString(raw.playwrightLocator, 500);
    const testId = clampString(raw.testId, 200);
    const testIdAttr = clampString(raw.testIdAttr, 64);
    const role = clampString(raw.role, 64);
    const accessibleName = clampString(raw.accessibleName, 200);
    const selectorMatches = finiteNumber(raw.selectorMatches);

    if (selector) out.selector = selector;
    if (selectorMatches !== null && selectorMatches >= 0) out.selectorMatches = selectorMatches;
    if (xpath) out.xpath = xpath;
    if (playwrightLocator) out.playwrightLocator = playwrightLocator;
    if (testId) out.testId = testId;
    if (testIdAttr) out.testIdAttr = testIdAttr;
    if (role) out.role = role;
    if (accessibleName) out.accessibleName = accessibleName;
    if (tagName) out.tagName = tagName;
    if (text) out.text = text;
    if (value) out.value = value;
    if (inlineStyle) out.inlineStyle = inlineStyle;
    const rect = sanitizeRect(raw.rect);
    if (rect) out.rect = rect;
    if (raw.styles && typeof raw.styles === "object") {
      const styles = {};
      for (const key of ["color", "backgroundColor", "fontSize", "display", "visibility"]) {
        const v = clampString(raw.styles[key], 100);
        if (v) styles[key] = v;
      }
      if (Object.keys(styles).length) out.styles = styles;
    }
    if (raw.a11y && typeof raw.a11y === "object") {
      const a11y = {};
      const contrastRatio = finiteNumber(raw.a11y.contrastRatio);
      if (contrastRatio !== null) a11y.contrastRatio = contrastRatio;
      const wcagLevel = clampString(raw.a11y.wcagLevel, 16);
      if (wcagLevel) a11y.wcagLevel = wcagLevel;
      if (Array.isArray(raw.a11y.warnings)) {
        const warnings = raw.a11y.warnings
          .map((w) => clampString(w, 250))
          .filter(Boolean)
          .slice(0, 8);
        if (warnings.length) a11y.warnings = warnings;
      }
      if (Object.keys(a11y).length) out.a11y = a11y;
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

  function sanitizeDiagnostics(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    if (raw.environment && typeof raw.environment === "object") {
      const env = {};
      for (const key of ["viewport", "userAgent", "language", "url", "timestamp"]) {
        const v = clampString(raw.environment[key], 500);
        if (v) env[key] = v;
      }
      const dpr = finiteNumber(raw.environment.devicePixelRatio);
      if (dpr !== null) env.devicePixelRatio = dpr;
      if (Object.keys(env).length) out.environment = env;
    }
    if (Array.isArray(raw.consoleErrors)) {
      const consoleErrors = raw.consoleErrors.slice(0, 15).map((item) => {
        if (!item || typeof item !== "object") return null;
        const message = clampString(item.message, 500);
        if (!message) return null;
        return {
          type: clampString(item.type, 50) || "console.error",
          message,
          source: clampString(item.source, 250) || undefined,
          count: finiteNumber(item.count) || 1
        };
      }).filter(Boolean);
      if (consoleErrors.length) out.consoleErrors = consoleErrors;
    }
    if (Array.isArray(raw.networkErrors)) {
      const networkErrors = raw.networkErrors.slice(0, 15).map((item) => {
        if (!item || typeof item !== "object") return null;
        const url = clampString(item.url, 500);
        if (!url) return null;
        return {
          method: clampString(item.method, 16) || "GET",
          url,
          status: finiteNumber(item.status) ?? 0,
          statusText: clampString(item.statusText, 120) || undefined,
          durationMs: finiteNumber(item.durationMs) ?? 0,
          count: finiteNumber(item.count) || 1
        };
      }).filter(Boolean);
      if (networkErrors.length) out.networkErrors = networkErrors;
    }
    if (Array.isArray(raw.reproSteps)) {
      const reproSteps = raw.reproSteps.slice(0, 15).map((step) => {
        if (!step || typeof step !== "object") return null;
        const description = clampString(step.description, 300);
        if (!description) return null;
        return {
          action: clampString(step.action, 32) || "click",
          tagName: clampString(step.tagName, 32) || undefined,
          selector: clampString(step.selector, 500) || undefined,
          label: clampString(step.label, 100) || undefined,
          value: clampString(step.value, 100) || undefined,
          description
        };
      }).filter(Boolean);
      if (reproSteps.length) out.reproSteps = reproSteps;
    }
    return Object.keys(out).length ? out : null;
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
    const out = {
      timestamp: finiteNumber(source.timestamp) || Date.now(),
      url: clampString(source.url, 2048) || "",
      title: clampString(source.title, 300) || "",
      items,
      prompt: clampString(source.prompt, 200000) || ""
    };
    const diagnostics = sanitizeDiagnostics(source.diagnostics);
    if (diagnostics) out.diagnostics = diagnostics;
    return out;
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
