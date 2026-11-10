import { prisma } from "./prisma.js";
import { defaultWhatsAppSession, env } from "./env.js";
import { syncAdminUserFromEnv } from "./services/adminUser.js";
import { defaultHotmartGraph } from "./engine/graph.js";

async function main() {
  if (!prisma) {
    console.error("DATABASE_URL necessário para seed");
    process.exit(1);
  }

  await syncAdminUserFromEnv();

  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      wppBaseUrl: env.WAHA_BASE_URL,
      wppSession: defaultWhatsAppSession()
    }
  });

  const existing = await prisma.flow.findFirst({ where: { name: "Pós-compra Hotmart" } });
  if (!existing) {
    await prisma.flow.create({
      data: {
        name: "Pós-compra Hotmart",
        enabled: false,
        graphJson: defaultHotmartGraph() as object,
        schemaVersion: 1
      }
    });
  }

  console.log("Seed OK:", env.ADMIN_EMAIL);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma?.$disconnect());
