import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { readUnsubscribeToken } from "../services/email/deliverability.js";

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <main style="max-width:420px;margin:48px auto;background:#fff;border:1px solid #e4e4e7;border-radius:16px;padding:28px;">
    <h1 style="font-size:20px;margin:0 0 12px;">${title}</h1>
    <p style="margin:0;line-height:1.5;color:#3f3f46;">${body}</p>
  </main>
</body>
</html>`;
}

export async function emailPublicRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, typeof body === "string" ? body : "");
    }
  );

  app.route({
    method: ["GET", "POST"],
    url: "/api/email/unsubscribe",
    handler: async (req, reply) => {
      const token = String((req.query as { t?: string }).t ?? "");
      const email = readUnsubscribeToken(token, env.JWT_SECRET);
      if (!email) {
        return reply
          .type("text/html; charset=utf-8")
          .status(400)
          .send(page("Link inválido", "Este cancelamento não confere. Use o link do e-mail mais recente."));
      }
      if (prisma) {
        await prisma.emailSuppression.upsert({
          where: { email },
          update: {},
          create: { email }
        });
      }
      if (req.method === "POST") {
        return reply.status(200).send({ ok: true });
      }
      return reply
        .type("text/html; charset=utf-8")
        .send(
          page(
            "Cancelado",
            "Este endereço não recebe mais e-mails enviados por aqui. O próximo fluxo que tentar escrever para ele é ignorado."
          )
        );
    }
  });
}
