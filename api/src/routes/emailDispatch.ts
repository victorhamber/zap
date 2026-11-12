import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { listEmailDispatches } from "../services/email/listEmailDispatches.js";

export async function emailDispatchRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/email/dispatches", async (_req, reply) => {
    try {
      const result = await listEmailDispatches();
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({ ok: false, error: message });
    }
  });
}
