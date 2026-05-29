import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { deleteMediaFile, listMediaLibrary } from "../services/mediaLibrary.js";

export async function mediaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/media", async (req) => {
    const q = req.query as { filter?: string };
    const filter =
      q.filter === "received" || q.filter === "sent" ? q.filter : "all";
    return listMediaLibrary(filter);
  });

  app.delete("/api/media/:filename", async (req, reply) => {
    const filename = decodeURIComponent((req.params as { filename: string }).filename);
    const result = await deleteMediaFile(filename);
    if (!result.ok) {
      return reply.status(400).send({ ok: false, message: result.message ?? "Falha ao excluir" });
    }
    return { ok: true };
  });
}
