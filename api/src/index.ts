import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import staticPlugin from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { authRoutes } from "./routes/auth.js";
import { flowRoutes } from "./routes/flows.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { runRoutes } from "./routes/runs.js";
import { settingsRoutes } from "./routes/settings.js";
import { wppRoutes } from "./routes/wpp.js";
import { inboxRoutes } from "./routes/inbox.js";
import { bootstrapDatabase } from "./bootstrap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({ logger: true });

app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
  try {
    const text = typeof body === "string" ? body : "";
    done(null, text.trim() ? JSON.parse(text) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

await app.register(cors, {
  origin:
    env.CORS_ORIGIN === "*"
      ? true
      : env.CORS_ORIGIN.split(",").map((s: string) => s.trim()),
  credentials: true
});

await app.register(sensible);

app.get("/api/health", async () => ({ ok: true, service: "zap-automation" }));

await app.register(authRoutes);
await app.register(webhookRoutes);
await app.register(flowRoutes);
await app.register(runRoutes);
await app.register(settingsRoutes);
await app.register(wppRoutes);
await app.register(inboxRoutes);

const webDist = path.resolve(__dirname, "../../web/dist");
await app.register(staticPlugin, { root: webDist, prefix: "/" });
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith("/api")) {
    return reply.status(404).send({ error: "Not found" });
  }
  return reply.sendFile("index.html");
});

const port = Number(process.env.PORT ?? 3000);

if (prisma) {
  await prisma.$connect();
  await bootstrapDatabase();
} else if (process.env.NODE_ENV === "production") {
  app.log.error("DATABASE_URL obrigatório em produção");
  process.exit(1);
} else {
  app.log.warn("Sem DATABASE_URL — rotas de persistência indisponíveis");
}

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
