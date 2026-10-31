import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeHeapSnapshot } from "../../../devtools/heap-analysis.mjs";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-pilot-heap-analysis-"));
const meta = {
  node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"],
  node_types: [["hidden", "object", "synthetic", "native"]],
  edge_fields: ["type", "name_or_index", "to_node"],
  edge_types: [["context", "element", "property", "internal"]]
};
const strings = ["", "(GC roots)", "App", "app", "Detached HTMLDivElement", "child", "NativeContext", "captured"];
const makeSnapshot = (extraDetached = false) => ({
  snapshot: { meta },
  strings,
  nodes: [
    2, 1, 1, 0, 1, 0, 0,
    1, 2, 2, 100, 1, 0, 0,
    1, 4, 3, 50, 0, 0, 2,
    3, 6, 4, 20, 1, 0, 0,
    1, 7, 5, 30, 0, 0, 0,
    ...(extraDetached ? [1, 4, 4, 75, 0, 0, 2] : [])
  ],
  edges: [2, 3, 7, 2, 5, 14, 0, 7, 28]
});

const firstPath = path.join(tempDir, "before.heapsnapshot");
const secondPath = path.join(tempDir, "after.heapsnapshot");
await fs.writeFile(firstPath, JSON.stringify(makeSnapshot(false)));
await fs.writeFile(secondPath, JSON.stringify(makeSnapshot(true)));

try {
  const summary = await analyzeHeapSnapshot({ filePath: firstPath, action: "summary" });
  assert.equal(summary.nodeCount, 5);
  assert.equal(summary.detachedDomNodes.count, 1);
  assert(summary.topConstructors.some(item => item.name === "App"));

  const query = await analyzeHeapSnapshot({ filePath: firstPath, action: "query", isDetached: true });
  assert.equal(query.total, 1);
  assert.equal(query.objects[0].name, "Detached HTMLDivElement");

  const details = await analyzeHeapSnapshot({ filePath: firstPath, action: "details", nodeId: 1 });
  assert(details.outgoing.some(edge => edge.name === "child"));

  const classNodes = await analyzeHeapSnapshot({ filePath: firstPath, action: "class_nodes", className: "App" });
  assert.equal(classNodes.total, 1);
  assert.equal(classNodes.nodes[0].id, 2);
  assert.equal(classNodes.selfSize, 100);

  const contextAnalysis = await analyzeHeapSnapshot({ filePath: firstPath, action: "analyze_contexts" });
  assert.equal(contextAnalysis.total, 1);
  assert.equal(contextAnalysis.deadCapturedCount, 1);
  assert.equal(contextAnalysis.deadCapturedContexts[0].captured[0].toName, "captured");

  const paths = await analyzeHeapSnapshot({ filePath: firstPath, action: "retaining_paths", nodeId: 2 });
  assert(paths.paths.some(pathItems => pathItems.at(-1)?.name === "(GC roots)"));
  const dominatorTree = await analyzeHeapSnapshot({ filePath: firstPath, action: "dominators", maxItems: 10 });
  assert(dominatorTree.dominators.some(item => item.name === "App" && item.retainedSize === 150));
  const dominatorChain = await analyzeHeapSnapshot({ filePath: firstPath, action: "dominator_chain", nodeId: 2 });
  assert.deepEqual(dominatorChain.dominatorChain.map(item => item.name), ["(GC roots)", "App", "Detached HTMLDivElement"]);
  assert.equal(dominatorChain.retainedSize, 50);

  const compare = await analyzeHeapSnapshot({ action: "compare", baseFilePath: firstPath, currentFilePath: secondPath });
  assert(compare.constructors.some(item => item.name === "Detached HTMLDivElement" && item.deltaCount === 1));

  const closed = await analyzeHeapSnapshot({ action: "close_snapshot", filePath: firstPath });
  assert.equal(closed.closed, true);
  assert.equal(closed.removedEntries, 1);
  const reopened = await analyzeHeapSnapshot({ filePath: firstPath, action: "summary" });
  assert.equal(reopened.nodeCount, 5);

  console.log("PASS heap snapshot analysis");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
