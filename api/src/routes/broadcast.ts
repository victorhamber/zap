import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { listAllGroups } from "../services/whatsapp/index.js";
import { listBroadcastEmails, startBroadcast } from "../services/broadcastDispatch.js";

export async function broadcastRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/broadcast/targets", async (_req, reply) => {
    try {
      const [groups, emails] = await Promise.all([listAllGroups(), listBroadcastEmails()]);
      return { ok: true, groups, emailCount: emails.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ ok: false, groups: [], emailCount: 0, error: message });
    }
  });

  app.post("/api/broadcast", async (req, reply) => {
    const body = req.body as {
      text?: string;
      groupIds?: string[];
      email?: boolean;
      subject?: string;
      media?: unknown;
    };
    try {
      const result = await startBroadcast({
        text: body.text ?? "",
        groupIds: Array.isArray(body.groupIds) ? body.groupIds : [],
        email: body.email === true,
        subject: body.subject ?? "",
        media: body.media
      });
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ ok: false, error: message });
    }
  });
}
