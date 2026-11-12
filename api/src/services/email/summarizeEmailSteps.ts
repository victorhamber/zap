export type EmailStepRow = {
  flow: string;
  status: string;
  message: string;
};

export type EmailFlowTotal = {
  flow: string;
  sent: number;
  skipped: number;
  failed: number;
};

export function emailStepOutcome(status: string, message: string): "sent" | "skipped" | "failed" {
  if (status === "failed") return "failed";
  if (/não enviado|cancelou|ignor/i.test(message)) return "skipped";
  if (status === "ok") return "sent";
  return "failed";
}

export function summarizeEmailSteps(rows: EmailStepRow[]): {
  sent: number;
  skipped: number;
  failed: number;
  byFlow: EmailFlowTotal[];
} {
  const sent = { n: 0 };
  const skipped = { n: 0 };
  const failed = { n: 0 };
  const flows = new Map<string, EmailFlowTotal>();
  for (const row of rows) {
    const outcome = emailStepOutcome(row.status, row.message);
    if (outcome === "sent") sent.n += 1;
    else if (outcome === "skipped") skipped.n += 1;
    else failed.n += 1;
    const name = row.flow || "Fluxo";
    const current = flows.get(name) ?? { flow: name, sent: 0, skipped: 0, failed: 0 };
    current[outcome] += 1;
    flows.set(name, current);
  }
  return {
    sent: sent.n,
    skipped: skipped.n,
    failed: failed.n,
    byFlow: [...flows.values()].sort((a, b) => b.sent + b.failed + b.skipped - (a.sent + a.failed + a.skipped))
  };
}
