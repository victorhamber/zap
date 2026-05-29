import bcrypt from "bcrypt";
import { prisma } from "./prisma.js";
import { env, flags } from "./env.js";
import { defaultHotmartGraph } from "./engine/graph.js";
import {
  startWppReconnectWatchdog,
  tryRestoreSessionAfterDeploy
} from "./services/wppReconnect.js";
import {
  ensureInboxCaptureStarted,
  normalizeInboxSessionKeys
} from "./services/inboxStore.js";

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

  const instanceCount = await prisma.wppInstance.count();
  if (instanceCount === 0) {
    await prisma.wppInstance.create({
      data: { name: env.WPP_SESSION, label: env.WPP_SESSION }
    });
    console.log(`[bootstrap] Instância padrão criada: ${env.WPP_SESSION}`);
  }

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

  await normalizeInboxSessionKeys();

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (settings?.connectionStatus?.startsWith("CONNECTED")) {
    await ensureInboxCaptureStarted();
  }

  if (flags.isProd) {
    if (!env.ZAP_INTERNAL_URL?.trim()) {
      console.warn(
        "[bootstrap] AVISO: ZAP_INTERNAL_URL não definido — mensagens recebidas do WhatsApp provavelmente NÃO chegarão ao inbox."
      );
    }
    if (!env.WPP_INTERNAL_URL?.trim()) {
      console.warn(
        "[bootstrap] AVISO: WPP_INTERNAL_URL não definido — o Zap pode não alcançar o wppconnect na rede Docker."
      );
    }
  }

  void tryRestoreSessionAfterDeploy();
  startWppReconnectWatchdog();
}
