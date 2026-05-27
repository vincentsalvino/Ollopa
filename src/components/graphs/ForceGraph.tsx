import { useRef, useEffect, useState, useCallback } from "react";
import type { GraphNode, GraphEdge } from "../../types";

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface ForceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  onNodeClick?: (node: GraphNode) => void;
}

const NODE_COLORS: Record<string, string> = {
  session: "#810B38",
  decision: "#ffa502",
  file: "#2dd47b",
  tag: "#7c5cbf",
  component: "#3b82f6",
  step: "#06b6d4",
  rust: "#e44d26",
  typescript: "#3178c6",
  javascript: "#f7df1e",
  style: "#e06aad",
  config: "#8b8b8b",
  doc: "#a0a0b8",
};

const NODE_RADIUS: Record<string, number> = {
  session: 18,
  decision: 16,
  component: 16,
  file: 10,
  tag: 12,
  step: 12,
};

function getColor(nodeType: string): string {
  return NODE_COLORS[nodeType] || "#6c6c8a";
}

function getRadius(nodeType: string): number {
  return NODE_RADIUS[nodeType] || 10;
}

function initLayout(nodes: GraphNode[], w: number, h: number): LayoutNode[] {
  const cx = w / 2;
  const cy = h / 2;
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = Math.min(w, h) * 0.3;
    return {
      ...n,
      x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
    };
  });
}

function simulate(
  layoutNodes: LayoutNode[],
  edges: GraphEdge[],
  w: number,
  h: number
): LayoutNode[] {
  const cx = w / 2;
  const cy = h / 2;
  const nodes = layoutNodes.map((n) => ({ ...n }));
  const idxMap = new Map<string, number>();
  nodes.forEach((n, i) => idxMap.set(n.id, i));

  // Repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = 800 / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[i].vx -= fx;
      nodes[i].vy -= fy;
      nodes[j].vx += fx;
      nodes[j].vy += fy;
    }
  }

  // Attraction (edges)
  for (const e of edges) {
    const si = idxMap.get(e.source);
    const ti = idxMap.get(e.target);
    if (si === undefined || ti === undefined) continue;
    const dx = nodes[ti].x - nodes[si].x;
    const dy = nodes[ti].y - nodes[si].y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - 80) * 0.02;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    nodes[si].vx += fx;
    nodes[si].vy += fy;
    nodes[ti].vx -= fx;
    nodes[ti].vy -= fy;
  }

  // Center gravity
  for (const n of nodes) {
    n.vx += (cx - n.x) * 0.005;
    n.vy += (cy - n.y) * 0.005;
  }

  // Apply velocity with damping
  for (const n of nodes) {
    n.vx *= 0.85;
    n.vy *= 0.85;
    n.x += n.vx;
    n.y += n.vy;
    // Boundary
    const pad = 20;
    n.x = Math.max(pad, Math.min(w - pad, n.x));
    n.y = Math.max(pad, Math.min(h - pad, n.y));
  }

  return nodes;
}

export default function ForceGraph({
  nodes,
  edges,
  width,
  height,
  onNodeClick,
}: ForceGraphProps) {
  const [layout, setLayout] = useState<LayoutNode[]>(() =>
    initLayout(nodes, width, height)
  );
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const animRef = useRef<number>(0);
  const iterRef = useRef(0);

  useEffect(() => {
    const newLayout = initLayout(nodes, width, height);
    setLayout(newLayout);
    iterRef.current = 0;
  }, [nodes, edges, width, height]);

  useEffect(() => {
    const maxIter = 120;
    let running = true;

    function tick() {
      if (!running || iterRef.current >= maxIter) return;
      iterRef.current++;
      setLayout((prev) => simulate(prev, edges, width, height));
      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [nodes, edges, width, height]);

  const nodeMap = new Map<string, LayoutNode>();
  layout.forEach((n) => nodeMap.set(n.id, n));

  const handleNodeClick = useCallback(
    (n: LayoutNode) => {
      if (onNodeClick) {
        onNodeClick(n);
      }
    },
    [onNodeClick]
  );

  if (nodes.length === 0) {
    return (
      <div className="graph-empty">
        <p>No data to visualize yet.</p>
        <p className="graph-empty-hint">
          Create session summaries or decisions in the Brain panel to populate graphs.
        </p>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className="force-graph-svg"
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Edges */}
      {edges.map((e, i) => {
        const src = nodeMap.get(e.source);
        const tgt = nodeMap.get(e.target);
        if (!src || !tgt) return null;
        const highlighted =
          hoveredNode === e.source || hoveredNode === e.target;
        return (
          <line
            key={`e-${i}`}
            x1={src.x}
            y1={src.y}
            x2={tgt.x}
            y2={tgt.y}
            stroke={highlighted ? "#810B38" : "var(--border-accent)"}
            strokeWidth={highlighted ? 2 : Math.max(1, e.weight * 0.5)}
            strokeOpacity={highlighted ? 0.9 : 0.4}
          />
        );
      })}

      {/* Nodes */}
      {layout.map((n) => {
        const r = getRadius(n.node_type);
        const color = getColor(n.node_type);
        const isHovered = hoveredNode === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            onMouseEnter={() => setHoveredNode(n.id)}
            onMouseLeave={() => setHoveredNode(null)}
            onClick={() => handleNodeClick(n)}
            style={{ cursor: "pointer" }}
          >
            <circle
              r={isHovered ? r + 3 : r}
              fill={color}
              stroke={isHovered ? "#fff" : "transparent"}
              strokeWidth={2}
              opacity={isHovered ? 1 : 0.85}
            />
            <text
              y={r + 14}
              textAnchor="middle"
              fill="var(--text-secondary)"
              fontSize={10}
              fontWeight={isHovered ? 600 : 400}
            >
              {n.label.length > 20 ? n.label.slice(0, 18) + "..." : n.label}
            </text>
          </g>
        );
      })}

      {/* Tooltip for hovered node */}
      {hoveredNode && (() => {
        const n = nodeMap.get(hoveredNode);
        if (!n) return null;
        return (
          <g transform={`translate(${n.x + 20},${n.y - 10})`}>
            <rect
              x={0}
              y={-14}
              width={Math.min(n.label.length * 7 + 30, 200)}
              height={22}
              rx={4}
              fill="var(--bg-surface)"
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={6}
              y={2}
              fill="var(--text-primary)"
              fontSize={11}
              fontWeight={500}
            >
              {n.label}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}
