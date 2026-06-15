import bcrypt from "bcrypt";
import { prisma } from "../prisma.js";
import { env } from "../env.js";

/** Sincroniza admin do .env; ao mudar a senha, invalida JWTs emitidos antes. */
export async function syncAdminUserFromEnv(): Promise<void> {
  if (!prisma) return;

  const email = env.ADMIN_EMAIL;
  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
    await prisma.user.create({
      data: { email, passwordHash, tokenVersion: 0 }
    });
    return;
  }

  const samePassword = await bcrypt.compare(env.ADMIN_PASSWORD, existing.passwordHash);
  if (samePassword) return;

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  await prisma.user.update({
    where: { email },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 }
    }
  });
  console.log(`[auth] Senha de ${email} alterada — sessões JWT anteriores invalidadas`);
}
