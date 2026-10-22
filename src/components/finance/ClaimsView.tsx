"use client";

import { useState } from "react";
import { Check, Plus, RotateCcw, X, Download, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/finance";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { ClaimStatus, Department, ExpenseClaim } from "@/types";
import { Button, ErrorText, Field, Modal, Panel, selectStyle } from "@/components/lc/ui";
import ReceiptButton from "./ReceiptButton";
import { askConfirm } from "@/components/ui/confirm";
import { formatDay } from "@/lib/dates";

const STATUS_STYLE: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: "Pending",  color: "var(--color-warning)", bg: "var(--color-warning-bg)" },
  approved: { label: "Approved", color: "var(--color-success)", bg: "var(--color-success-bg)" },
  rejected: { label: "Rejected", color: "var(--color-error)",   bg: "var(--color-error-bg)" },
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: s.color, backgroundColor: s.bg, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

interface Props {
  claims: ExpenseClaim[];
  userId: string;
  departments: Department[];
  memberNames: Record<string, string>;
  isFinanceLead: boolean;
  onNewClaim: () => void;
  onChanged: () => void;
}

export default function ClaimsView({ claims, userId, departments, memberNames, isFinanceLead, onNewClaim, onChanged }: Props) {
  const [status, setStatus] = useState<"all" | ClaimStatus>(isFinanceLead ? "pending" : "all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseClaim | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = claims.filter((c) => status === "all" || c.status === status);
  const mine = claims.every((c) => c.submittedBy === userId);
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "No department";

  async function review(claim: ExpenseClaim, next: ClaimStatus, reason?: string) {
    setBusyId(claim.id);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("review_expense_claim", { p_claim_id: claim.id, p_status: next, p_reason: reason ?? null });
      if (err) throw new Error(err.message);
      setRejecting(null);
      onChanged();
    } catch (e) {
      setError(`Couldn't update the claim: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function withdraw(claim: ExpenseClaim) {
    if (!(await askConfirm("Withdraw this claim?", { confirmLabel: "Withdraw" }))) return;
    setBusyId(claim.id);
    setError(null);
    try {
      const { error: err } = await supabase.from("expense_claims").delete().eq("id", claim.id);
      if (err) throw new Error(err.message);
      await supabase.storage.from("receipts").remove([claim.receiptPath]).catch(() => {});
      onChanged();
    } catch (e) {
      setError(`Couldn't withdraw the claim: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    downloadCsv(`expense-claims-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(visible, [
      { header: "Submitted", value: (c) => c.createdAt.slice(0, 10) },
      { header: "Expense date", value: (c) => c.date },
      { header: "Submitted by", value: (c) => memberNames[c.submittedBy] ?? "" },
      { header: "Department", value: (c) => deptName(c.departmentId) },
      { header: "Description", value: (c) => c.description },
      { header: "Amount", value: (c) => c.amount.toFixed(2) },
      { header: "Currency", value: (c) => c.currency },
      { header: "Status", value: (c) => c.status },
      { header: "Rejection reason", value: (c) => c.rejectionReason ?? "" },
    ]));
  }

  return (
    <Panel
      title={mine ? "My expense claims" : "Expense claims"}
      action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ ...selectStyle, width: 130, height: 34 }}>
          <option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
        {!mine && <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}><Download size={14} aria-hidden="true" /> CSV</Button>}
        <Button onClick={onNewClaim}><Plus size={14} aria-hidden="true" /> New claim</Button>
      </div>}
    >
      <ErrorText>{error}</ErrorText>
      {visible.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", padding: "16px 14px", margin: 0 }}>
          {claims.length === 0 ? "No claims yet. Paid for something for the LC? Submit a claim with the receipt." : "No claims with this status."}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {visible.map((c) => (
            <li key={c.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--color-border)", opacity: busyId === c.id ? 0.6 : 1 }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-body)", margin: 0 }}>{c.description}</p>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", margin: "2px 0 0" }}>
                  {!mine && <>{memberNames[c.submittedBy] ?? "Someone"} · </>}{deptName(c.departmentId)} · {formatDay(c.date)}
                </p>
                {c.status === "rejected" && c.rejectionReason && (
                  <p style={{ fontSize: 12, color: "var(--color-error)", margin: "4px 0 0" }}>Reason: {c.rejectionReason}</p>
                )}
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--color-body)" }}>{formatMoney(c.amount, c.currency)}</span>
              <ClaimStatusBadge status={c.status} />
              <ReceiptButton path={c.receiptPath} />
              {isFinanceLead && c.status === "pending" && (
                <span style={{ display: "inline-flex", gap: 6 }}>
                  <Button onClick={() => review(c, "approved")} disabled={busyId === c.id}><Check size={14} aria-hidden="true" /> Approve</Button>
                  <Button variant="danger" onClick={() => setRejecting(c)} disabled={busyId === c.id}><X size={14} aria-hidden="true" /> Reject</Button>
                </span>
              )}
              {isFinanceLead && c.status !== "pending" && (
                <Button variant="ghost" onClick={() => review(c, "pending")} disabled={busyId === c.id} title={c.status === "approved" ? "Removes the ledger entry" : undefined}>
                  <RotateCcw size={13} aria-hidden="true" /> {c.status === "approved" ? "Un-approve" : "Reopen"}
                </Button>
              )}
              {!isFinanceLead && c.submittedBy === userId && c.status === "pending" && (
                <Button variant="ghost" onClick={() => withdraw(c)} disabled={busyId === c.id}><Trash2 size={13} aria-hidden="true" /> Withdraw</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {rejecting && (
        <RejectModal
          claim={rejecting}
          busy={busyId === rejecting.id}
          error={error}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => review(rejecting, "rejected", reason)}
        />
      )}
    </Panel>
  );
}

function RejectModal({ claim, busy, error, onClose, onConfirm }: {
  claim: ExpenseClaim; busy: boolean; error: string | null; onClose: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Reject claim" onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => onConfirm(reason.trim())} disabled={!reason.trim() || busy}>{busy ? "Rejecting…" : "Reject claim"}</Button>
      </>}
    >
      <p style={{ fontSize: 13, color: "var(--color-body)", marginTop: 0 }}>
        {claim.description} · {formatMoney(claim.amount, claim.currency)}
      </p>
      <Field label="Reason (the submitter will see this)" htmlFor="reject-reason">
        <textarea
          id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--color-border)", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "var(--font-roboto)", backgroundColor: "var(--color-surface)", color: "var(--color-body)" }}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
