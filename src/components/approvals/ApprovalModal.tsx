import type { ApprovalRequestData } from "../../types";

interface ApprovalModalProps {
  approval: ApprovalRequestData;
  onApprove: () => void;
  onDeny: () => void;
}

export default function ApprovalModal({
  approval,
  onApprove,
  onDeny,
}: ApprovalModalProps) {
  const riskClass = `risk-${approval.risk_level.toLowerCase()}`;

  return (
    <div className="modal-overlay" onClick={onDeny}>
      <div className="modal approval-modal" onClick={(e) => e.stopPropagation()}>
        <div className="approval-modal-header">
          <span className={`approval-risk-icon ${riskClass}`}>
            {approval.risk_level === "Critical"
              ? "\u26A0"
              : approval.risk_level === "High"
              ? "\u26A0"
              : "\u2139"}
          </span>
          <h3>Tool Approval Required</h3>
        </div>

        <div className="approval-modal-body">
          <div className="approval-field">
            <label>Tool</label>
            <span className="approval-tool-name">{approval.tool_name}</span>
          </div>

          <div className="approval-field">
            <label>Risk Level</label>
            <span className={`approval-risk-badge ${riskClass}`}>
              {approval.risk_level}
            </span>
          </div>

          {approval.risk_label && (
            <div className="approval-field">
              <label>Description</label>
              <span className="approval-risk-desc">{approval.risk_label}</span>
            </div>
          )}

          {Object.keys(approval.input).length > 0 && (
            <div className="approval-field">
              <label>Input</label>
              <pre className="approval-input-pre">
                {JSON.stringify(approval.input, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="approval-modal-actions">
          <button className="btn-approve" onClick={onApprove}>
            Approve
          </button>
          <button className="btn-deny" onClick={onDeny}>
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
