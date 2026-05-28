import { useMemo, useState } from "react";
import type { GraphNode, GraphEdge } from "../../types";

interface DAGViewProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  onNodeClick?: (node: GraphNode) => void;
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  depth: number;
  col: number;
}

const STEP_COLORS: Record<string, string> = {
  session: "#810B38",
  step: "#3b82f6",
  decision: "#ffa502",
};

function layoutDAG(
  nodes: GraphNode[],
  edges: GraphEdge[],
  w: number,
  h: number
): LayoutNode[] {
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string[]>();

  for (const e of edges) {
    if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
    childrenMap.get(e.source)!.push(e.target);
    if (!parentMap.has(e.target)) parentMap.set(e.target, []);
    parentMap.get(e.target)!.push(e.source);
  }

  // Find roots (nodes with no parents)
  const roots = nodes.filter((n) => !parentMap.has(n.id) || parentMap.get(n.id)!.length === 0);

  // BFS to assign depth
  const depthMap = new Map<string, number>();
  const queue: { id: string; depth: number }[] = roots.map((r) => ({ id: r.id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depthMap.has(id)) continue;
    depthMap.set(id, depth);
    const children = childrenMap.get(id) || [];
    for (const c of children) {
      if (!depthMap.has(c)) {
        queue.push({ id: c, depth: depth + 1 });
      }
    }
  }

  // Assign depth to any orphaned nodes
  for (const n of nodes) {
    if (!depthMap.has(n.id)) {
      depthMap.set(n.id, 0);
    }
  }

  // Group by depth
  const layers = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = depthMap.get(n.id) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d)!.push(n);
  }

  const maxDepth = Math.max(0, ...Array.from(layers.keys()));
  const rowHeight = Math.max(60, h / (maxDepth + 2));
  const yPad = 40;

  const result: LayoutNode[] = [];
  for (const [depth, layerNodes] of layers) {
    const colWidth = w / (layerNodes.length + 1);
    layerNodes.forEach((n, i) => {
      result.push({
        ...n,
        x: colWidth * (i + 1),
        y: yPad + depth * rowHeight,
        depth,
        col: i,
      });
    });
  }

  return result;
}

export default function DAGView({
  nodes,
  edges,
  width,
  height,
  onNodeClick,
}: DAGViewProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const layout = useMemo(
    () => layoutDAG(nodes, edges, width, height),
    [nodes, edges, width, height]
  );

  const nodeMap = new Map<string, LayoutNode>();
  layout.forEach((n) => nodeMap.set(n.id, n));

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>No workflow data to visualize.</p>
        <p className="graph-empty-hint">
          Session summaries with key actions will populate this DAG.
        </p>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={Math.max(height, (layout.reduce((m, n) => Math.max(m, n.depth), 0) + 2) * 70)}
      className="dag-view-svg"
      viewBox={`0 0 ${width} ${Math.max(height, (layout.reduce((m, n) => Math.max(m, n.depth), 0) + 2) * 70)}`}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="var(--border-accent)" />
        </marker>
        <marker
          id="arrowhead-active"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#810B38" />
        </marker>
      </defs>

      {/* Edges with arrows */}
      {edges.map((e, i) => {
        const src = nodeMap.get(e.source);
        const tgt = nodeMap.get(e.target);
        if (!src || !tgt) return null;
        const active = hoveredNode === e.source || hoveredNode === e.target;
        return (
          <line
            key={`e-${i}`}
            x1={src.x}
            y1={src.y + 16}
            x2={tgt.x}
            y2={tgt.y - 16}
            stroke={active ? "#810B38" : "var(--border-accent)"}
            strokeWidth={active ? 2 : 1.5}
            strokeOpacity={active ? 0.9 : 0.5}
            markerEnd={active ? "url(#arrowhead-active)" : "url(#arrowhead)"}
          />
        );
      })}

      {/* Nodes */}
      {layout.map((n) => {
        const color = STEP_COLORS[n.node_type] || "#6c6c8a";
        const isHovered = hoveredNode === n.id;
        const isSession = n.node_type === "session";
        const rx = isSession ? 20 : 8;

        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            onMouseEnter={() => setHoveredNode(n.id)}
            onMouseLeave={() => setHoveredNode(null)}
            onClick={() => onNodeClick?.(n)}
            style={{ cursor: "pointer" }}
          >
            {isSession ? (
              <rect
                x={-40}
                y={-14}
                width={80}
                height={28}
                rx={rx}
                fill={color}
                stroke={isHovered ? "#fff" : "transparent"}
                strokeWidth={2}
                opacity={isHovered ? 1 : 0.85}
              />
            ) : (
              <rect
                x={-30}
                y={-12}
                width={60}
                height={24}
                rx={rx}
                fill={isHovered ? color : "var(--bg-surface)"}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1.5}
                opacity={isHovered ? 1 : 0.85}
              />
            )}
            <text
              textAnchor="middle"
              y={4}
              fill={isSession || isHovered ? "#fff" : "var(--text-primary)"}
              fontSize={isSession ? 10 : 9}
              fontWeight={isSession ? 700 : 500}
            >
              {n.label.length > 12 ? n.label.slice(0, 10) + ".." : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
