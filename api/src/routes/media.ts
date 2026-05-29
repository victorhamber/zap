import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { deleteAllMediaFiles, deleteMediaFile, deleteMediaFiles, listMediaLibrary } from "../services/mediaLibrary.js";

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

  app.post("/api/media/delete-bulk", async (req, reply) => {
    const body = req.body as { filenames?: string[]; all?: boolean; filter?: string };
    const filter =
      body.filter === "received" || body.filter === "sent" ? body.filter : "all";

    if (body.all) {
      const result = await deleteAllMediaFiles(filter);
      return { ok: result.ok, deleted: result.deleted };
    }

    const filenames = Array.isArray(body.filenames) ? body.filenames : [];
    if (filenames.length === 0) {
      return reply.status(400).send({ ok: false, message: "Nenhum arquivo selecionado" });
    }

    const result = await deleteMediaFiles(filenames);
    return {
      ok: result.ok,
      deleted: result.deleted,
      failed: result.failed
    };
  });
}
