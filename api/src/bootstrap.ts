import bcrypt from "bcrypt";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { defaultHotmartGraph } from "./engine/graph.js";

export async function bootstrapDatabase() {
  if (!prisma) return;

  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      wppBaseUrl: env.WPP_BASE_URL,
      wppSession: env.WPP_SESSION
    }
  });

  const hash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { passwordHash: hash },
    create: { email: env.ADMIN_EMAIL, passwordHash: hash }
  });
  console.log(`[bootstrap] Admin sincronizado: ${env.ADMIN_EMAIL}`);

  await prisma.wppInstance.upsert({
    where: { name: env.WPP_SESSION },
    update: {},
    create: { name: env.WPP_SESSION, label: env.WPP_SESSION }
  });

  const flows = await prisma.flow.count();
  if (flows === 0) {
    await prisma.flow.create({
      data: {
        name: "Pós-compra Hotmart",
        enabled: false,
        graphJson: defaultHotmartGraph() as object,
        schemaVersion: 1
      }
    });
    console.log("[bootstrap] Fluxo exemplo criado");
  }
}
