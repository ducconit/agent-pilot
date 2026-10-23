import fs from "node:fs/promises";

const snapshotCache = new Map();
const MAX_CACHE_ENTRIES = 4;

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseSize(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value;
  const match = String(value).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|kb|mb|gb)?(?:-|$)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multiplier = unit === "gb" ? 1024 ** 3 : unit === "mb" ? 1024 ** 2 : unit === "kb" ? 1024 : 1;
  return amount * multiplier;
}

function matchesText(value, filter) {
  if (filter === undefined || filter === null || filter === "") return true;
  const text = String(value || "");
  const pattern = String(filter);
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    const end = pattern.lastIndexOf("/");
    try {
      return new RegExp(pattern.slice(1, end), pattern.slice(end + 1)).test(text);
    } catch (_) {
      // Fall back to a case-insensitive substring for malformed regex input.
    }
  }
  return text.toLowerCase().includes(pattern.toLowerCase());
}

function nodeTypeName(snapshot, index) {
  const value = snapshot.nodes[index + snapshot.offsets.node.type];
  return snapshot.nodeTypes[value] || String(value);
}

function nodeName(snapshot, index) {
  const value = snapshot.nodes[index + snapshot.offsets.node.name];
  return String(snapshot.strings[value] ?? `(node ${index})`);
}

function nodeSummary(snapshot, index) {
  const node = snapshot.nodes;
  const type = nodeTypeName(snapshot, index);
  const name = nodeName(snapshot, index);
  const selfSize = numberOr(node[index + snapshot.offsets.node.selfSize]);
  const detachedness = snapshot.offsets.node.detachedness >= 0
    ? numberOr(node[index + snapshot.offsets.node.detachedness])
    : 0;
  return {
    nodeIndex: index,
    id: numberOr(node[index + snapshot.offsets.node.id]),
    type,
    name,
    selfSize,
    selfSizeKB: round(selfSize / 1024),
    selfSizeMB: round(selfSize / (1024 * 1024)),
    edgeCount: numberOr(node[index + snapshot.offsets.node.edgeCount]),
    detached: detachedness === 2 || name.startsWith("Detached ")
  };
}

function nodeIndexForParam(snapshot, value) {
  const nodeId = numberOr(value, -1);
  if (nodeId >= 0 && nodeId < snapshot.nodeCount) return nodeId * snapshot.nodeStride;
  return snapshot.nodes.findIndex((entry, offset) => (
    offset % snapshot.nodeStride === snapshot.offsets.node.id && entry === nodeId
  ));
}

function edgeLabel(snapshot, type, value) {
  if (["element", "hidden"].includes(type)) return String(value);
  return String(snapshot.strings[value] ?? value);
}

function edgeSummary(snapshot, edge) {
  const type = snapshot.edgeTypes[edge.type] || String(edge.type);
  const target = nodeSummary(snapshot, edge.toNode);
  return {
    type,
    name: edgeLabel(snapshot, type, edge.nameOrIndex),
    toNode: target.nodeIndex,
    toId: target.id,
    toType: target.type,
    toName: target.name,
    toSelfSize: target.selfSize
  };
}

function buildSnapshot(data, filePath) {
  const meta = data?.snapshot?.meta;
  if (!meta || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error("Invalid V8 heap snapshot: missing snapshot metadata, nodes, or edges");
  }
  const nodeFields = meta.node_fields || [];
  const edgeFields = meta.edge_fields || [];
  const nodeTypes = meta.node_types?.[0] || [];
  const edgeTypes = meta.edge_types?.[0] || [];
  const fieldOffset = (fields, name) => fields.indexOf(name);
  const nodeStride = nodeFields.length;
  const edgeStride = edgeFields.length;
  if (!nodeStride || !edgeStride) throw new Error("Invalid V8 heap snapshot metadata");

  const snapshot = {
    filePath,
    raw: data,
    nodes: data.nodes,
    edges: data.edges,
    strings: data.strings || [],
    nodeTypes,
    edgeTypes,
    nodeStride,
    edgeStride,
    nodeCount: Math.floor(data.nodes.length / nodeStride),
    offsets: {
      node: {
        type: fieldOffset(nodeFields, "type"),
        name: fieldOffset(nodeFields, "name"),
        id: fieldOffset(nodeFields, "id"),
        selfSize: fieldOffset(nodeFields, "self_size"),
        edgeCount: fieldOffset(nodeFields, "edge_count"),
        detachedness: fieldOffset(nodeFields, "detachedness")
      },
      edge: {
        type: fieldOffset(edgeFields, "type"),
        nameOrIndex: fieldOffset(edgeFields, "name_or_index"),
        toNode: fieldOffset(edgeFields, "to_node")
      }
    },
    edgeStart: [],
    incoming: null
  };

  let edgeCursor = 0;
  for (let index = 0; index < snapshot.nodes.length; index += nodeStride) {
    snapshot.edgeStart.push(edgeCursor);
    const edgeCount = numberOr(snapshot.nodes[index + snapshot.offsets.node.edgeCount]);
    edgeCursor += edgeCount * edgeStride;
  }
  return snapshot;
}

function outgoingEdges(snapshot, nodeIndex) {
  if (nodeIndex < 0) return [];
  const nodeOrdinal = Math.floor(nodeIndex / snapshot.nodeStride);
  if (nodeOrdinal < 0 || nodeOrdinal >= snapshot.nodeCount) return [];
  const start = snapshot.edgeStart[nodeOrdinal] || 0;
  const count = numberOr(snapshot.nodes[nodeIndex + snapshot.offsets.node.edgeCount]);
  const edges = [];
  for (let i = 0; i < count; i++) {
    const offset = start + i * snapshot.edgeStride;
    const toNode = numberOr(snapshot.edges[offset + snapshot.offsets.edge.toNode], -1);
    if (toNode < 0 || toNode >= snapshot.nodes.length) continue;
    edges.push({
      type: numberOr(snapshot.edges[offset + snapshot.offsets.edge.type]),
      nameOrIndex: numberOr(snapshot.edges[offset + snapshot.offsets.edge.nameOrIndex]),
      toNode
    });
  }
  return edges;
}

function incomingEdges(snapshot) {
  if (snapshot.incoming) return snapshot.incoming;
  const incoming = Array.from({ length: snapshot.nodeCount }, () => []);
  for (let nodeOrdinal = 0; nodeOrdinal < snapshot.nodeCount; nodeOrdinal++) {
    const nodeIndex = nodeOrdinal * snapshot.nodeStride;
    for (const edge of outgoingEdges(snapshot, nodeIndex)) {
      incoming[Math.floor(edge.toNode / snapshot.nodeStride)]?.push({ fromNode: nodeIndex, ...edge });
    }
  }
  snapshot.incoming = incoming;
  return incoming;
}

function constructorSummary(snapshot, limit = 20) {
  const groups = new Map();
  for (let index = 0; index < snapshot.nodes.length; index += snapshot.nodeStride) {
    const item = nodeSummary(snapshot, index);
    if (["hidden", "synthetic", "number", "code"].includes(item.type) && !item.detached) continue;
    const key = item.name || "(anonymous)";
    const current = groups.get(key) || { name: key, type: item.type, count: 0, selfSize: 0 };
    current.count += 1;
    current.selfSize += item.selfSize;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => b.selfSize - a.selfSize || b.count - a.count)
    .slice(0, Math.min(100, Math.max(1, Number(limit) || 20)))
    .map(item => ({ ...item, selfSizeKB: round(item.selfSize / 1024), selfSizeMB: round(item.selfSize / (1024 * 1024)) }));
}

function summary(snapshot, params) {
  let totalSelfSize = 0;
  let detachedCount = 0;
  let detachedBytes = 0;
  const nativeContexts = [];
  for (let index = 0; index < snapshot.nodes.length; index += snapshot.nodeStride) {
    const item = nodeSummary(snapshot, index);
    totalSelfSize += item.selfSize;
    if (item.detached) { detachedCount += 1; detachedBytes += item.selfSize; }
    if (item.type === "native" && /context/i.test(item.name)) nativeContexts.push(item);
  }
  return {
    filePath: snapshot.filePath,
    nodeCount: snapshot.nodeCount,
    edgeCount: Math.floor(snapshot.edges.length / snapshot.edgeStride),
    totalSelfSize,
    totalSelfSizeMB: round(totalSelfSize / (1024 * 1024)),
    detachedDomNodes: { count: detachedCount, selfSize: detachedBytes, selfSizeKB: round(detachedBytes / 1024) },
    topConstructors: constructorSummary(snapshot, params.maxItems),
    nativeContexts: nativeContexts.slice(0, Math.min(100, Number(params.maxItems) || 20))
  };
}

function query(snapshot, params) {
  const minSelf = parseSize(params.selfSize);
  const maxSelf = params.maxSelfSize === undefined ? null : parseSize(params.maxSelfSize);
  const rows = [];
  for (let index = 0; index < snapshot.nodes.length; index += snapshot.nodeStride) {
    const item = nodeSummary(snapshot, index);
    if (!matchesText(item.name, params.className) && !matchesText(item.name, params.name)) continue;
    if (params.nodeType && !matchesText(item.type, params.nodeType)) continue;
    if (params.isDetached !== undefined && Boolean(params.isDetached) !== item.detached) continue;
    if (minSelf !== null && item.selfSize < minSelf) continue;
    if (maxSelf !== null && item.selfSize > maxSelf) continue;
    if (params.propertyName) {
      const hasProperty = outgoingEdges(snapshot, index).some(edge => matchesText(edgeLabel(snapshot, snapshot.edgeTypes[edge.type] || "", edge.nameOrIndex), params.propertyName));
      if (!hasProperty) continue;
    }
    rows.push(item);
  }
  rows.sort((a, b) => {
    const field = params.sortBy === "name" ? "name" : params.sortBy === "selfSize" ? "selfSize" : "edgeCount";
    return typeof a[field] === "string" ? a[field].localeCompare(b[field]) : b[field] - a[field];
  });
  const pageSize = Math.min(1000, Math.max(1, Number(params.pageSize) || 50));
  const pageIdx = Math.max(0, Number(params.pageIdx) || 0);
  return { total: rows.length, pageIdx, pageSize, objects: rows.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize) };
}

function classNodes(snapshot, params) {
  const className = params.className ?? params.name;
  if (className === undefined || className === null || className === "") throw new Error("className is required");
  const exact = params.exact !== false;
  const nodes = [];
  for (let index = 0; index < snapshot.nodes.length; index += snapshot.nodeStride) {
    const item = nodeSummary(snapshot, index);
    const matches = exact ? item.name === String(className) : matchesText(item.name, className);
    if (matches) nodes.push(item);
  }
  const pageSize = Math.min(1000, Math.max(1, Number(params.pageSize) || 50));
  const pageIdx = Math.max(0, Number(params.pageIdx) || 0);
  const page = nodes.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize);
  const selfSize = nodes.reduce((total, item) => total + item.selfSize, 0);
  return {
    className: String(className),
    exact,
    total: nodes.length,
    count: nodes.length,
    selfSize,
    selfSizeKB: round(selfSize / 1024),
    selfSizeMB: round(selfSize / (1024 * 1024)),
    pageIdx,
    pageSize,
    nodes: page
  };
}

function details(snapshot, params) {
  const index = nodeIndexForParam(snapshot, params.nodeId);
  if (index < 0 || index >= snapshot.nodes.length) throw new Error(`Heap node not found: ${params.nodeId}`);
  const incoming = incomingEdges(snapshot)[Math.floor(index / snapshot.nodeStride)] || [];
  return {
    node: nodeSummary(snapshot, index),
    outgoing: outgoingEdges(snapshot, index).slice(0, Math.min(100, Number(params.maxItems) || 50)).map(edge => edgeSummary(snapshot, edge)),
    incoming: incoming.slice(0, Math.min(100, Number(params.maxItems) || 50)).map(edge => ({ fromNode: edge.fromNode, ...edgeSummary(snapshot, edge) }))
  };
}

function edges(snapshot, params) {
  const index = nodeIndexForParam(snapshot, params.nodeId);
  if (index < 0) throw new Error(`Heap node not found: ${params.nodeId}`);
  return { node: nodeSummary(snapshot, index), edges: outgoingEdges(snapshot, index).map(edge => edgeSummary(snapshot, edge)) };
}

function retainingPaths(snapshot, params) {
  const target = numberOr(params.nodeId, -1);
  const targetIndex = nodeIndexForParam(snapshot, target);
  if (targetIndex < 0) throw new Error(`Heap node not found: ${params.nodeId}`);
  const incoming = incomingEdges(snapshot);
  const maxDepth = Math.min(50, Math.max(1, Number(params.maxDepth) || 8));
  const maxPaths = Math.min(100, Math.max(1, Number(params.maxNodes) || 20));
  const paths = [];
  const queue = [{ index: targetIndex, path: [targetIndex] }];
  const seen = new Set([targetIndex]);
  while (queue.length && paths.length < maxPaths) {
    const current = queue.shift();
    const currentNode = nodeSummary(snapshot, current.index);
    const parents = incoming[Math.floor(current.index / snapshot.nodeStride)] || [];
    if (!parents.length || /^(root|gc roots|\(gc roots\)|\(global object\))$/i.test(currentNode.name)) {
      paths.push(current.path.map(index => nodeSummary(snapshot, index)));
      continue;
    }
    if (current.path.length >= maxDepth) continue;
    for (const parent of parents.slice(0, Math.min(100, Number(params.maxSiblings) || 20))) {
      if (seen.has(parent.fromNode)) continue;
      seen.add(parent.fromNode);
      queue.push({ index: parent.fromNode, path: [...current.path, parent.fromNode] });
    }
  }
  return { target: nodeSummary(snapshot, targetIndex), paths, truncated: queue.length > 0 };
}

function dominators(snapshot, params) {
  const count = snapshot.nodeCount;
  const adjacency = Array.from({ length: count }, () => []);
  const predecessors = Array.from({ length: count }, () => []);
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const nodeIndex = ordinal * snapshot.nodeStride;
    for (const edge of outgoingEdges(snapshot, nodeIndex)) {
      const target = Math.floor(edge.toNode / snapshot.nodeStride);
      if (target < 0 || target >= count) continue;
      adjacency[ordinal].push(target);
      predecessors[target].push(ordinal);
    }
  }

  const roots = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const item = nodeSummary(snapshot, ordinal * snapshot.nodeStride);
    if (item.type === "synthetic" && /root|gc roots/i.test(item.name)) roots.push(ordinal);
  }
  if (!roots.length) {
    for (let ordinal = 0; ordinal < count; ordinal++) if (!predecessors[ordinal].length) roots.push(ordinal);
  }
  if (!roots.length && count) roots.push(0);

  const virtualRoot = count;
  const childrenOf = node => node === virtualRoot ? roots : adjacency[node];
  const visited = new Set([virtualRoot]);
  const postorder = [];
  const stack = [{ node: virtualRoot, next: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const children = childrenOf(frame.node);
    if (frame.next < children.length) {
      const child = children[frame.next++];
      if (visited.has(child)) continue;
      visited.add(child);
      stack.push({ node: child, next: 0 });
    } else {
      postorder.push(frame.node);
      stack.pop();
    }
  }
  const rpo = postorder.reverse();
  const rpoIndex = new Int32Array(count + 1).fill(-1);
  rpo.forEach((node, index) => { rpoIndex[node] = index; });
  const immediateDominator = new Int32Array(count + 1).fill(-1);
  immediateDominator[virtualRoot] = virtualRoot;
  const intersect = (left, right) => {
    let a = left;
    let b = right;
    while (a !== b) {
      while (rpoIndex[a] > rpoIndex[b]) a = immediateDominator[a];
      while (rpoIndex[b] > rpoIndex[a]) b = immediateDominator[b];
    }
    return a;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of rpo) {
      if (node === virtualRoot) continue;
      const candidates = roots.includes(node) ? [virtualRoot, ...predecessors[node]] : predecessors[node];
      let next = -1;
      for (const predecessor of candidates) {
        if (immediateDominator[predecessor] < 0) continue;
        next = next < 0 ? predecessor : intersect(predecessor, next);
      }
      if (next >= 0 && immediateDominator[node] !== next) {
        immediateDominator[node] = next;
        changed = true;
      }
    }
  }

  const tree = Array.from({ length: count + 1 }, () => []);
  for (let node = 0; node < count; node++) {
    const parent = immediateDominator[node];
    if (parent >= 0) tree[parent].push(node);
  }
  const retained = new Array(count).fill(0);
  for (let node = 0; node < count; node++) retained[node] = nodeSummary(snapshot, node * snapshot.nodeStride).selfSize;
  for (const node of [...rpo].reverse()) {
    const parent = immediateDominator[node];
    if (node !== virtualRoot && parent >= 0 && parent < count) retained[parent] += retained[node];
  }
  const maxItems = Math.min(1000, Math.max(1, Number(params.maxItems) || 100));
  const rows = [];
  for (let node = 0; node < count; node++) {
    if (immediateDominator[node] < 0) continue;
    const item = nodeSummary(snapshot, node * snapshot.nodeStride);
    rows.push({
      ...item,
      immediateDominator: immediateDominator[node] < count ? nodeSummary(snapshot, immediateDominator[node] * snapshot.nodeStride) : null,
      retainedSize: retained[node],
      retainedSizeKB: round(retained[node] / 1024),
      retainedSizeMB: round(retained[node] / (1024 * 1024)),
      dominatedNodeCount: tree[node].length
    });
  }
  rows.sort((a, b) => b.retainedSize - a.retainedSize || b.selfSize - a.selfSize);
  if (params.nodeId !== undefined && params.nodeId !== null) {
    const targetIndex = nodeIndexForParam(snapshot, params.nodeId);
    if (targetIndex < 0) throw new Error(`Heap node not found: ${params.nodeId}`);
    const target = Math.floor(targetIndex / snapshot.nodeStride);
    const chain = [];
    const seen = new Set();
    let current = target;
    while (current >= 0 && current !== virtualRoot && !seen.has(current)) {
      seen.add(current);
      chain.push(rows.find(item => item.nodeIndex === current * snapshot.nodeStride));
      current = immediateDominator[current];
    }
    chain.reverse();
    const node = rows.find(item => item.nodeIndex === targetIndex);
    return {
      rootCount: roots.length,
      reachableNodeCount: rpo.length - 1,
      node,
      dominatorChain: chain,
      retainedSize: node?.retainedSize ?? 0,
      retainedSizeKB: node?.retainedSizeKB ?? 0,
      retainedSizeMB: node?.retainedSizeMB ?? 0
    };
  }
  return { rootCount: roots.length, reachableNodeCount: rpo.length - 1, dominators: rows.slice(0, maxItems) };
}

function contextAnalysis(snapshot, params) {
  const incoming = incomingEdges(snapshot);
  const adjacency = Array.from({ length: snapshot.nodeCount }, () => []);
  const contexts = [];
  for (let ordinal = 0; ordinal < snapshot.nodeCount; ordinal++) {
    const index = ordinal * snapshot.nodeStride;
    const item = nodeSummary(snapshot, index);
    const outgoing = outgoingEdges(snapshot, index);
    adjacency[ordinal] = outgoing.map(edge => Math.floor(edge.toNode / snapshot.nodeStride));
    if (!/context/i.test(item.name)) continue;
    contexts.push({ ordinal, item, outgoing });
  }

  const roots = [];
  for (let ordinal = 0; ordinal < snapshot.nodeCount; ordinal++) {
    const item = nodeSummary(snapshot, ordinal * snapshot.nodeStride);
    if (item.type === "synthetic" && /root|gc roots/i.test(item.name)) roots.push(ordinal);
  }
  if (!roots.length) {
    for (let ordinal = 0; ordinal < snapshot.nodeCount; ordinal++) if (!incoming[ordinal]?.length) roots.push(ordinal);
  }
  const reachable = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    for (const target of adjacency[queue.shift()] || []) {
      if (target < 0 || target >= snapshot.nodeCount || reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }

  const rows = contexts.map(({ ordinal, item, outgoing }) => {
    const captured = outgoing
      .filter(edge => (snapshot.edgeTypes[edge.type] || String(edge.type)) === "context")
      .map(edge => edgeSummary(snapshot, edge));
    const retainers = (incoming[ordinal] || []).map(edge => ({
      fromNode: edge.fromNode,
      ...edgeSummary(snapshot, edge)
    }));
    const dead = !reachable.has(ordinal) && captured.length > 0;
    return {
      ...item,
      reachable: reachable.has(ordinal),
      deadCaptured: dead,
      captured,
      retainers
    };
  });
  const className = params.className === undefined ? null : String(params.className);
  const filtered = className === null ? rows : rows.filter(row => matchesText(row.name, className));
  const maxItems = Math.min(1000, Math.max(1, Number(params.maxItems) || 100));
  return {
    heuristic: true,
    note: "Dead captured contexts are inferred from graph reachability and context edges in the snapshot.",
    total: filtered.length,
    deadCapturedCount: filtered.filter(row => row.deadCaptured).length,
    contexts: filtered.slice(0, maxItems),
    deadCapturedContexts: filtered.filter(row => row.deadCaptured).slice(0, maxItems)
  };
}

function duplicateStrings(snapshot, params) {
  const counts = new Map();
  for (const value of snapshot.strings) counts.set(value, (counts.get(value) || 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
  const pageSize = Math.min(1000, Math.max(1, Number(params.pageSize) || 50));
  const pageIdx = Math.max(0, Number(params.pageIdx) || 0);
  return { total: duplicates.length, pageIdx, pageSize, strings: duplicates.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize) };
}

function compareSnapshots(base, current, params) {
  const aggregate = snapshot => {
    const map = new Map();
    for (let index = 0; index < snapshot.nodes.length; index += snapshot.nodeStride) {
      const item = nodeSummary(snapshot, index);
      const previous = map.get(item.name) || { name: item.name, type: item.type, count: 0, selfSize: 0 };
      previous.count += 1; previous.selfSize += item.selfSize; map.set(item.name, previous);
    }
    return map;
  };
  const before = aggregate(base), after = aggregate(current);
  const names = new Set([...before.keys(), ...after.keys()]);
  const rows = [...names].map(name => {
    const b = before.get(name) || { type: "", count: 0, selfSize: 0 };
    const a = after.get(name) || { type: b.type, count: 0, selfSize: 0 };
    return { name, type: a.type || b.type, baselineCount: b.count, currentCount: a.count, deltaCount: a.count - b.count, baselineSelfSize: b.selfSize, currentSelfSize: a.selfSize, deltaSelfSize: a.selfSize - b.selfSize };
  }).filter(row => row.deltaCount !== 0 || row.deltaSelfSize !== 0);
  rows.sort((a, b) => b.deltaSelfSize - a.deltaSelfSize || b.deltaCount - a.deltaCount);
  return { baseline: base.filePath, current: current.filePath, totalChanged: rows.length, constructors: rows.slice(0, Math.min(1000, Number(params.maxItems) || 100)) };
}

async function loadSnapshot(filePath) {
  const resolved = filePath;
  const stat = await fs.stat(resolved);
  const cacheKey = `${resolved}:${stat.size}:${stat.mtimeMs}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached) return cached;
  const data = JSON.parse(await fs.readFile(resolved, "utf8"));
  const snapshot = buildSnapshot(data, resolved);
  snapshotCache.set(cacheKey, snapshot);
  while (snapshotCache.size > MAX_CACHE_ENTRIES) snapshotCache.delete(snapshotCache.keys().next().value);
  return snapshot;
}

function closeSnapshot(filePath) {
  let removedEntries = 0;
  for (const [key, snapshot] of snapshotCache) {
    if (snapshot.filePath !== filePath) continue;
    snapshotCache.delete(key);
    removedEntries += 1;
  }
  return { filePath, closed: removedEntries > 0, removedEntries };
}

export async function analyzeHeapSnapshot(params = {}) {
  const action = String(params.action || "summary").toLowerCase().replace(/-/g, "_");
  if (action === "close" || action === "close_snapshot") {
    if (!params.filePath) throw new Error("filePath is required for close");
    return closeSnapshot(params.filePath);
  }
  if (action === "compare") {
    if (!params.baseFilePath || !params.currentFilePath) throw new Error("baseFilePath and currentFilePath are required for compare");
    return compareSnapshots(await loadSnapshot(params.baseFilePath), await loadSnapshot(params.currentFilePath), params);
  }
  if (!params.filePath) throw new Error("filePath is required unless action is compare");
  const snapshot = await loadSnapshot(params.filePath);
  if (action === "summary" || action === "details") return action === "summary" ? summary(snapshot, params) : details(snapshot, params);
  if (action === "query" || action === "objects") return query(snapshot, params);
  if (action === "edges") return edges(snapshot, params);
  if (action === "retainers") {
    const incoming = incomingEdges(snapshot);
    const index = nodeIndexForParam(snapshot, params.nodeId);
    if (index < 0) throw new Error(`Heap node not found: ${params.nodeId}`);
    return { node: nodeSummary(snapshot, index), retainers: (incoming[Math.floor(index / snapshot.nodeStride)] || []).map(edge => ({ fromNode: edge.fromNode, ...edgeSummary(snapshot, edge) })) };
  }
  if (action === "retaining_paths" || action === "dominator") return retainingPaths(snapshot, params);
  if (action === "dominators" || action === "dominator_chain") return dominators(snapshot, params);
  if (action === "duplicate_strings") return duplicateStrings(snapshot, params);
  if (action === "class_nodes" || action === "class_details") return classNodes(snapshot, params);
  if (action === "contexts") return query(snapshot, { ...params, nodeType: "native", className: params.className || "context" });
  if (action === "analyze_contexts" || action === "context_analysis") return contextAnalysis(snapshot, params);
  throw new Error(`Unsupported heap analysis action: ${action}`);
}
