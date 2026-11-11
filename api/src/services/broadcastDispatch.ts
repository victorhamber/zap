import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { getRedisConnection, sanitizeQueueJobId } from "../queue.js";
import { sendAudio, sendDocument, sendImage, sendText, sendVideo } from "./whatsapp/index.js";
import { sendTransactionalEmail } from "./email/resend.js";
import {
  emailGapMs,
  filterGroupIds,
  groupGapMs,
  parseBroadcastMedia,
  textToEmailHtml,
  type BroadcastMedia
} from "./broadcastPlan.js";

const QUEUE = "zap-broadcast";
const MAX_GROUPS = 80;

export type BroadcastJob = {
  channel: "group" | "email";
  batchId: string;
  text: string;
  subject: string;
  media: BroadcastMedia | null;
  targets: string[];
  index: number;
};

let queue: Queue<BroadcastJob> | null = null;

function broadcastQueue(): Queue<BroadcastJob> {
  if (!queue) {
    queue = new Queue<BroadcastJob>(QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000, attempts: 1 }
    });
  }
  return queue;
}

async function enqueueBroadcast(job: BroadcastJob, delayMs: number) {
  const jobId = sanitizeQueueJobId(`bc_${job.batchId}_${job.channel}_${job.index}`);
  await broadcastQueue().add(job.channel, job, { delay: Math.max(0, delayMs), jobId });
}

export async function listBroadcastEmails(): Promise<string[]> {
  if (!prisma) return [];
  const rows = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: { email: true }
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

async function sendGroupPiece(target: string, text: string, media: BroadcastMedia | null) {
  if (!media) {
    await sendText(target, text, { isGroup: true });
    return;
  }
  const file = media.filename || undefined;
  if (media.kind === "image") {
    await sendImage(target, media.url, text, { isGroup: true, fileName: file });
    return;
  }
  if (media.kind === "video") {
    await sendVideo(target, media.url, text, { isGroup: true, fileName: file });
    return;
  }
  if (media.kind === "audio") {
    await sendAudio(target, media.url, { isGroup: true });
    if (text) await sendText(target, text, { isGroup: true });
    return;
  }
  await sendDocument(target, media.url, text, file, { isGroup: true });
}

export async function startBroadcast(input: {
  text: string;
  groupIds: string[];
  email: boolean;
  subject: string;
  media?: unknown;
}): Promise<{ groups: number; emails: number }> {
  const text = input.text.trim();
  const media = parseBroadcastMedia(input.media);
  if (input.media && !media) throw new Error("O arquivo precisa ser imagem, vídeo, áudio ou documento com link http.");
  if (!text && !media) throw new Error("Escreva a mensagem ou escolha um arquivo.");
  if (text.length > 4000) throw new Error("A mensagem passa de 4000 caracteres.");
  const groups = filterGroupIds(input.groupIds);
  if (groups.length > MAX_GROUPS) throw new Error(`No máximo ${MAX_GROUPS} grupos por disparo.`);
  let emails: string[] = [];
  if (input.email) {
    const subject = input.subject.trim();
    if (!subject) throw new Error("O e-mail precisa de assunto.");
    emails = await listBroadcastEmails();
    if (emails.length === 0) throw new Error("Nenhum contato com e-mail.");
  }
  if (groups.length === 0 && emails.length === 0) {
    throw new Error("Escolha ao menos um grupo ou o e-mail.");
  }

  const batchId = String(Date.now());
  if (groups.length > 0) {
    await enqueueBroadcast(
      { channel: "group", batchId, text, subject: "", media, targets: groups, index: 0 },
      0
    );
  }
  if (emails.length > 0) {
    await enqueueBroadcast(
      { channel: "email", batchId, text, subject: input.subject.trim(), media, targets: emails, index: 0 },
      0
    );
  }
  return { groups: groups.length, emails: emails.length };
}

export async function processBroadcastJob(job: BroadcastJob): Promise<void> {
  const target = job.targets[job.index];
  if (!target) return;
  try {
    if (job.channel === "group") {
      await sendGroupPiece(target, job.text, job.media ?? null);
    } else {
      await sendTransactionalEmail({
        to: target,
        subject: job.subject,
        html: textToEmailHtml(job.text, job.media),
        preheader: job.subject
      });
    }
  } catch (err) {
    console.error(`[broadcast] ${job.channel} ${target} falhou`, err);
  }
  const next = job.index + 1;
  if (next >= job.targets.length) return;
  const delay =
    job.channel === "group"
      ? groupGapMs()
      : emailGapMs(env.EMAIL_DISPATCH_MIN_SEC, env.EMAIL_DISPATCH_MAX_SEC);
  await enqueueBroadcast({ ...job, index: next }, delay);
}

export function startBroadcastWorker(): Worker<BroadcastJob> {
  const worker = new Worker<BroadcastJob>(
    QUEUE,
    async (job: Job<BroadcastJob>) => {
      await processBroadcastJob(job.data);
    },
    { connection: getRedisConnection(), concurrency: 1 }
  );
  worker.on("failed", (job, err) => {
    console.error("[broadcast] job falhou", job?.id, err);
  });
  return worker;
}
