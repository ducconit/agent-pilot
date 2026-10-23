/** Matched CSS, inherited rules, source locations and cascade diagnostics. */
function compareRank(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta) return delta;
  }
  return 0;
}

export function formatMatchedStyles(matched, computed, headers = new Map(), layerTree = null) {
  const layers = new Map();
  function visit(layer, parent = "") {
    if (!layer) return;
    const name = parent ? `${parent}.${layer.name}` : layer.name;
    layers.set(name, layer.order || 0);
    for (const child of layer.subLayers || []) visit(child, name);
  }
  for (const layer of layerTree?.subLayers || []) visit(layer);
  const rules = [];
  function addStyle(style, rule = {}, match = {}, inheritedDepth = 0, inline = false) {
    if (!style) return;
    const header = headers.get(style.styleSheetId || rule.styleSheetId) || {};
    const selectors = rule.selectorList?.selectors || [];
    const matching = match.matchingSelectors || selectors.map((_, i) => i);
    const specificity = matching.map(i => selectors[i]?.specificity).filter(Boolean).map(s => [s.a || 0, s.b || 0, s.c || 0]).sort(compareRank).at(-1) || [0, 0, 0];
    const layerName = (rule.layers || []).map(l => l.text).reverse().join(".");
    const mediaActive = (rule.media || []).every(m => !m.mediaList?.length || m.mediaList.some(query => query.active));
    const supportsActive = (rule.supports || []).every(s => s.active !== false);
    const range = style.range || rule.selectorList?.range;
    rules.push({
      selector: inline ? "element.style" : rule.selectorList?.text || "[attributes]",
      origin: rule.origin || "regular", inline, inheritedDepth,
      styleSheetId: style.styleSheetId || rule.styleSheetId,
      sourceURL: header.sourceURL || "", line: range ? (header.startLine || 0) + range.startLine + 1 : undefined,
      column: range ? range.startColumn + (range.startLine === 0 ? header.startColumn || 0 : 0) + 1 : undefined,
      specificity, layer: layerName || undefined,
      media: rule.media || [], supports: rule.supports || [], scopes: rule.scopes || [],
      containerQueries: rule.containerQueries || [],
      active: mediaActive && supportsActive,
      declarations: (style.cssProperties || []).map((p, index) => ({ name: p.name, value: p.value, important: !!p.important, disabled: !!p.disabled, implicit: !!p.implicit, parsedOk: p.parsedOk !== false, range: p.range, longhandProperties: p.longhandProperties, index }))
    });
  }
  // Protocol matched rules are emitted in increasing cascade order.
  const addMatches = (matches, depth) => (matches || []).forEach(match => addStyle(match.rule.style, match.rule, match, depth));
  addStyle(matched.attributesStyle);
  addMatches(matched.matchedCSSRules, 0);
  addStyle(matched.inlineStyle, {}, {}, 0, true);
  (matched.inherited || []).forEach((entry, index) => {
    addMatches(entry.matchedCSSRules, index + 1);
    addStyle(entry.inlineStyle, {}, {}, index + 1, true);
  });
  const winners = new Map();
  const candidates = [];
  rules.forEach((rule, ruleIndex) => {
    rule.declarations.forEach(property => {
      if (!rule.active || property.disabled || !property.parsedOk) { property.status = "inactive"; return; }
      // Keep inherited scopes separate: non-inherited properties in an ancestor
      // must never override declarations on the selected element.
      const origin = property.important ? ({ "user-agent": 6, user: 5 }[rule.origin] || 4) : ({ "user-agent": 0, user: 1 }[rule.origin] || 2);
      const layerOrder = layers.get(rule.layer) ?? 0;
      const layerRank = rule.layer ? (property.important ? 100000 - layerOrder : layerOrder) : (property.important ? -1 : 100000);
      const rank = [origin, rule.inline ? 1 : 0, layerRank, ...rule.specificity, ruleIndex, property.index];
      const names = property.longhandProperties?.length ? property.longhandProperties.map(p => p.name) : [property.name];
      const candidate = { property, rank, names, depth: rule.inheritedDepth };
      candidates.push(candidate);
      for (const name of names) {
        const key = `${rule.inheritedDepth}:${name}`;
        const previous = winners.get(key);
        if (!previous || compareRank(rank, previous.rank) > 0) winners.set(key, candidate);
      }
    });
  });
  for (const candidate of candidates) {
    const activeNames = candidate.names.filter(name => winners.get(`${candidate.depth}:${name}`) === candidate);
    candidate.property.status = activeNames.length === 0 ? "overloaded" : activeNames.length === candidate.names.length ? "active" : "partial";
    if (candidate.property.status === "partial") candidate.property.activeLonghands = activeNames;
    delete candidate.property.index;
  }
  rules.sort((a, b) => a.inheritedDepth - b.inheritedDepth || Number(b.inline) - Number(a.inline) || compareRank(b.specificity, a.specificity));
  return { rules, computed: Object.fromEntries((computed.computedStyle || []).map(p => [p.name, p.value])), registeredProperties: matched.cssPropertyRegistrations || [], pseudoElements: matched.pseudoElements || [], keyframes: matched.cssKeyframesRules || [] };
}

const CSS_PROPERTY_GROUPS = {
  layout: [
    "display", "position", "inset", "top", "right", "bottom", "left", "z-index", "box-sizing", "width", "min-width", "max-width", "height", "min-height", "max-height", "overflow", "overflow-x", "overflow-y", "visibility", "float", "clear", "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "grid", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "align-items", "align-content", "align-self", "justify-items", "justify-content", "justify-self", "order"
  ],
  box: [
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "border", "border-width", "border-style", "border-color", "border-radius", "box-shadow", "outline", "outline-width", "outline-style", "outline-color"
  ],
  typography: [
    "font", "font-family", "font-size", "font-weight", "font-style", "font-variant", "line-height", "letter-spacing", "text-align", "text-decoration", "text-transform", "text-indent", "text-overflow", "white-space", "word-break", "word-wrap"
  ],
  color: ["color", "background", "background-color", "background-image", "background-position", "background-size", "background-repeat", "opacity"],
  effects: ["transform", "transform-origin", "transition", "transition-duration", "transition-property", "animation", "animation-name", "animation-duration", "filter", "backdrop-filter", "cursor", "pointer-events"]
};

const SUMMARY_PROPERTIES = [
  ...CSS_PROPERTY_GROUPS.layout.slice(0, 18),
  ...CSS_PROPERTY_GROUPS.box.slice(0, 10),
  ...CSS_PROPERTY_GROUPS.typography.slice(0, 8),
  ...CSS_PROPERTY_GROUPS.color,
  ...CSS_PROPERTY_GROUPS.effects.slice(0, 6)
];

function selectedCssProperties(computed, options, detail) {
  const requested = Array.isArray(options.properties) ? options.properties.map(String).filter(Boolean) : [];
  const requestedGroups = Array.isArray(options.groups) ? options.groups.map(String) : [];
  const groupNames = requestedGroups.includes("all") ? Object.keys(CSS_PROPERTY_GROUPS) : requestedGroups.filter(name => CSS_PROPERTY_GROUPS[name]);
  const names = requested.length || groupNames.length
    ? [...new Set([...requested, ...groupNames.flatMap(name => CSS_PROPERTY_GROUPS[name])])]
    : detail === "computed" ? Object.keys(computed) : SUMMARY_PROPERTIES;
  return Object.fromEntries(names.filter(name => Object.prototype.hasOwnProperty.call(computed, name)).map(name => [name, computed[name]]));
}

function compactRule(rule, includeDeclarations) {
  if (includeDeclarations) return rule;
  const { declarations: _declarations, ...metadata } = rule;
  return metadata;
}

function inheritanceSummary(rules) {
  const directRules = rules.filter(rule => rule.inheritedDepth === 0);
  const inheritedRules = rules.filter(rule => rule.inheritedDepth > 0);
  const uniqueSources = [...new Map(inheritedRules.map(rule => [
    `${rule.inheritedDepth}:${rule.selector}:${rule.sourceURL}:${rule.line || 0}`,
    { selector: rule.selector, inheritedDepth: rule.inheritedDepth, origin: rule.origin, sourceURL: rule.sourceURL, line: rule.line, column: rule.column }
  ])).values()];
  const sources = uniqueSources.slice(0, 8);
  return { directRuleCount: directRules.length, inheritedRuleCount: inheritedRules.length, inheritedSources: sources, hasMoreSources: sources.length < uniqueSources.length };
}

export async function collectCssStyles(send, options, headers = new Map()) {
  await send("DOM.enable", {});
  const { root } = await send("DOM.getDocument", { depth: 0 });
  await send("CSS.enable", {});
  let nodeId = Number(options.nodeId) || 0;
  if (!nodeId && options.backendNodeId) {
    const result = await send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: [Number(options.backendNodeId)] });
    nodeId = result.nodeIds?.[0];
  }
  if (!nodeId) {
    if (!options.selector) throw new Error("selector, nodeId or backendNodeId is required");
    nodeId = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: options.selector })).nodeId;
  }
  if (!nodeId) throw new Error(`Element not found: ${options.selector}`);
  const [matched, computed, layers] = await Promise.all([
    send("CSS.getMatchedStylesForNode", { nodeId }),
    send("CSS.getComputedStyleForNode", { nodeId }),
    send("CSS.getLayersForNode", { nodeId }).catch(() => null)
  ]);
  const result = formatMatchedStyles(matched, computed, headers, layers?.rootLayer);
  const detail = ["summary", "computed", "rules", "full"].includes(String(options.detail || "").toLowerCase()) ? String(options.detail || "").toLowerCase() : "summary";
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 10));
  const pageIdx = Math.max(0, Number(options.pageIdx) || 0);
  const inheritance = inheritanceSummary(result.rules);
  const includeInherited = options.includeInherited === true || detail === "full";
  const visibleRules = includeInherited ? result.rules : result.rules.filter(rule => rule.inheritedDepth === 0);
  const includeDeclarations = options.includeDeclarations === true || detail === "rules" || detail === "full";
  const pagedRules = visibleRules.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize).map(rule => compactRule(rule, includeDeclarations));
  const common = {
    nodeId,
    detail,
    inheritance,
    cascadeNote: "Declaration status is resolved within each inherited scope; computed contains Chrome's final values. Scoping, animations and container-query evaluation may affect the final cascade."
  };
  if (detail === "full") {
    return { nodeId, ...result, rules: result.rules.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize), totalRules: result.rules.length, pageIdx, pageSize, hasMore: (pageIdx + 1) * pageSize < result.rules.length, detail, inheritance, cascadeNote: common.cascadeNote };
  }
  if (detail === "computed") {
    return { ...common, computed: selectedCssProperties(result.computed, options, detail) };
  }
  if (detail === "rules") {
    return { ...common, rules: pagedRules, totalRules: visibleRules.length, pageIdx, pageSize, hasMore: (pageIdx + 1) * pageSize < visibleRules.length };
  }
  return {
    ...common,
    computed: selectedCssProperties(result.computed, options, detail),
    matchedRules: { direct: inheritance.directRuleCount, inherited: inheritance.inheritedRuleCount },
    rulePage: { items: pagedRules.slice(0, Math.min(5, pagedRules.length)), total: visibleRules.length, pageIdx: 0, pageSize: Math.min(5, pageSize) }
  };
}
