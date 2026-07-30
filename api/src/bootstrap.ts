import { prisma } from "./prisma.js";
import { syncAdminUserFromEnv } from "./services/adminUser.js";
import { defaultWhatsAppSession, env, flags } from "./env.js";
import { isEvolution } from "./services/whatsapp/index.js";
import { defaultHotmartGraph } from "./engine/graph.js";
import {
  startWppReconnectWatchdog,
  tryRestoreSessionAfterDeploy
} from "./services/wppReconnect.js";
import {
  ensureInboxCaptureStarted,
  normalizeInboxSessionKeys,
  consolidateInboxChatIds
} from "./services/inboxStore.js";
import { startFlowScheduler } from "./services/flowScheduler.js";
import { startFlowStartWorker } from "./services/flowStartWorker.js";

export async function bootstrapDatabase() {
  if (!prisma) return;

  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      wppBaseUrl: env.WPP_BASE_URL,
      wppSession: defaultWhatsAppSession()
    }
  });

  await syncAdminUserFromEnv();
  console.log(`[bootstrap] Admin sincronizado: ${env.ADMIN_EMAIL}`);

  const instanceCount = await prisma.wppInstance.count();
  if (instanceCount === 0) {
    await prisma.wppInstance.create({
      data: { name: defaultWhatsAppSession(), label: defaultWhatsAppSession() }
    });
    console.log(`[bootstrap] Instância padrão criada: ${defaultWhatsAppSession()}`);
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
  await consolidateInboxChatIds();

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (settings?.connectionStatus?.startsWith("CONNECTED")) {
    await ensureInboxCaptureStarted();
  }

  console.log(`[bootstrap] WhatsApp provider: ${isEvolution ? "evolution" : "wppconnect"}`);

  if (flags.isProd) {
    if (!env.ZAP_INTERNAL_URL?.trim()) {
      console.warn(
        "[bootstrap] AVISO: ZAP_INTERNAL_URL não definido — mensagens recebidas provavelmente NÃO chegarão ao inbox."
      );
    }
    if (isEvolution) {
      if (!env.EVOLUTION_API_KEY?.trim()) {
        console.warn("[bootstrap] AVISO: EVOLUTION_API_KEY não definida.");
      }
      if (!env.EVOLUTION_INTERNAL_URL?.trim()) {
        console.warn(
          "[bootstrap] AVISO: EVOLUTION_INTERNAL_URL não definido — use URL interna Docker (ex.: http://evolution:8080)."
        );
      }
    } else if (!env.WPP_INTERNAL_URL?.trim()) {
      console.warn(
        "[bootstrap] AVISO: WPP_INTERNAL_URL não definido — o Zap pode não alcançar o wppconnect na rede Docker."
      );
    }
  }

  // Mensagens antigas gravadas como "📄 Template: nome" viram o texto real
  // assim que a definição chega da Meta. Em segundo plano: não atrasa o boot e
  // não impede a subida se o Graph API estiver fora do ar.
  void import("./services/inboxTemplateRepair.js")
    .then((m) => m.repairTemplatePlaceholders())
    .catch((err) => console.warn("[bootstrap] repair-templates falhou:", err));

  void tryRestoreSessionAfterDeploy();
  startWppReconnectWatchdog();
  startFlowScheduler();
  startFlowStartWorker();
}
