import { prisma } from "../../prisma.js";
import { emailStepOutcome, summarizeEmailSteps, type EmailStepRow } from "./summarizeEmailSteps.js";

export type EmailDispatchItem = {
  at: string;
  flow: string;
  phone: string;
  status: string;
  outcome: "sent" | "skipped" | "failed";
  message: string;
};

const SUMMARY_LIMIT = 1000;

export async function listEmailDispatches(): Promise<{
  total: number;
  truncated: boolean;
  sent: number;
  skipped: number;
  failed: number;
  byFlow: { flow: string; sent: number; skipped: number; failed: number }[];
  recent: EmailDispatchItem[];
}> {
  if (!prisma) {
    return { total: 0, truncated: false, sent: 0, skipped: 0, failed: 0, byFlow: [], recent: [] };
  }

  const total = await prisma.flowRunStep.count({ where: { nodeType: "send_email" } });
  const rows = await prisma.flowRunStep.findMany({
    where: { nodeType: "send_email" },
    orderBy: { createdAt: "desc" },
    take: SUMMARY_LIMIT,
    select: {
      createdAt: true,
      status: true,
      message: true,
      flowRun: {
        select: {
          contactPhone: true,
          flow: { select: { name: true } }
        }
      }
    }
  });

  const shaped: EmailStepRow[] = rows.map((row) => ({
    flow: row.flowRun.flow.name,
    status: row.status,
    message: row.message ?? ""
  }));
  const summary = summarizeEmailSteps(shaped);

  return {
    total,
    truncated: total > rows.length,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
    byFlow: summary.byFlow,
    recent: rows.slice(0, 80).map((row) => ({
      at: row.createdAt.toISOString(),
      flow: row.flowRun.flow.name,
      phone: row.flowRun.contactPhone,
      status: row.status,
      outcome: emailStepOutcome(row.status, row.message ?? ""),
      message: (row.message ?? "").slice(0, 180)
    }))
  };
}
