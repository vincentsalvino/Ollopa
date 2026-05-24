import type { GraphNode } from "../../types";

interface NodeDetailProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetail({ node, onClose }: NodeDetailProps) {
  if (!node) return null;

  const entries = Object.entries(node.metadata);

  return (
    <div className="node-detail-panel">
      <div className="node-detail-header">
        <div className="node-detail-title">
          <span
            className="node-detail-type-badge"
            data-type={node.node_type}
          >
            {node.node_type}
          </span>
          <span>{node.label}</span>
        </div>
        <button className="node-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      {entries.length > 0 && (
        <div className="node-detail-meta">
          {entries.map(([key, value]) => (
            <div key={key} className="node-detail-row">
              <span className="node-detail-key">{key}</span>
              <span className="node-detail-value">
                {value.length > 100 ? value.slice(0, 100) + "..." : value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="node-detail-footer">
        <span className="node-detail-id">ID: {node.id}</span>
      </div>
    </div>
  );
}
