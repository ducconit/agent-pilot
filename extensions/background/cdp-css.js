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
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 10));
  const pageIdx = Math.max(0, Number(options.pageIdx) || 0);
  return { nodeId, ...result, rules: result.rules.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize), totalRules: result.rules.length, pageIdx, pageSize, hasMore: (pageIdx + 1) * pageSize < result.rules.length, cascadeNote: "Declaration status is resolved within each inherited scope; computed contains Chrome's final values. Scoping, animations and container-query evaluation may affect the final cascade." };
}
