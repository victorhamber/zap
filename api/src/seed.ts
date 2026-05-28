import bcrypt from "bcrypt";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { defaultHotmartGraph } from "./engine/graph.js";

async function main() {
  if (!prisma) {
    console.error("DATABASE_URL necessário para seed");
    process.exit(1);
  }

  const hash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { passwordHash: hash },
    create: { email: env.ADMIN_EMAIL, passwordHash: hash }
  });

  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      wppBaseUrl: env.WPP_BASE_URL,
      wppSession: env.WPP_SESSION
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
