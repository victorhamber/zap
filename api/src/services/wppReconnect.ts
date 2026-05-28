import { prisma } from "../prisma.js";
import { env } from "../env.js";
import {
  isWppNetworkError,
  refreshWppToken,
  startSession,
  verifyActiveSession
} from "./wppconnect.js";

let reconnectInFlight = false;
let lastReconnectAt = 0;

const COOLDOWN_MS = env.WPP_RECONNECT_COOLDOWN_SEC * 1000;
const INTERVAL_MS = env.WPP_RECONNECT_INTERVAL_SEC * 1000;

function shouldWatchReconnect(connectionStatus: string | null | undefined): boolean {
  const cs = connectionStatus ?? "";
  if (!cs) return false;
  if (cs.startsWith("LOGOUT") || cs.startsWith("PAUSED") || cs.startsWith("AWAITING_QR")) {
    return false;
  }
  return (
    cs.startsWith("CONNECTED:") ||
    cs.startsWith("DISCONNECTED:") ||
    cs.includes("CLOSED") ||
    cs === "start_session" ||
    cs === "token_ok"
  );
}

function needsQrScan(state: string): boolean {
  const s = state.toUpperCase();
  return (
    s.includes("QR") ||
    s === "NOTLOGGED" ||
    s === "UNPAIRED" ||
    s === "QRCODE"
  );
}

/**
 * Tenta reabrir a sessão no WPP quando o aparelho caiu (token persiste no Postgres).
 */
export async function attemptAutoReconnect(options?: {
  reason?: string;
  skipCooldown?: boolean;
}): Promise<boolean> {
  if (!prisma || reconnectInFlight) return false;

  const reason = options?.reason ?? "watchdog";
  if (!options?.skipCooldown && Date.now() - lastReconnectAt < COOLDOWN_MS) {
    return false;
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.wppToken || !shouldWatchReconnect(settings.connectionStatus)) {
    return false;
  }

  reconnectInFlight = true;
  try {
    const check = await verifyActiveSession();
    if (check.connected) return true;

    if (!check.wppReachable) {
      console.warn(`[wpp-reconnect] WPP inacessível (${reason}), aguardando próxima tentativa.`);
      return false;
    }

    const state = check.state ?? "";
    if (needsQrScan(state)) {
      await prisma.appSettings.update({
        where: { id: "default" },
        data: { connectionStatus: `AWAITING_QR:${state}` }
      });
      console.log(
        `[wpp-reconnect] Sessão "${settings.wppSession}" exige novo QR (${state}), reconexão automática pausada.`
      );
      return false;
    }

    console.log(
      `[wpp-reconnect] Conexão caiu (${state}), tentando reconectar instância "${settings.wppSession}"…`
    );
    lastReconnectAt = Date.now();

    await refreshWppToken();
    await startSession({ waitQrCode: false });

    const after = await verifyActiveSession();
    if (after.connected) {
      console.log(`[wpp-reconnect] Reconectado com sucesso (${reason}).`);
      return true;
    }

    const afterState = after.state ?? "";
    if (needsQrScan(afterState)) {
      await prisma.appSettings.update({
        where: { id: "default" },
        data: { connectionStatus: `AWAITING_QR:${afterState}` }
      });
    }

    console.warn(`[wpp-reconnect] Tentativa não restabeleceu o aparelho (status: ${afterState}).`);
    return false;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (!isWppNetworkError(msg)) {
      console.warn(`[wpp-reconnect] Falha (${reason}): ${msg}`);
    }
    return false;
  } finally {
    reconnectInFlight = false;
  }
}

export function startWppReconnectWatchdog(): void {
  if (!prisma) return;
  if (!env.WPP_AUTO_RECONNECT) {
    console.log("[wpp-reconnect] Watchdog desativado (WPP_AUTO_RECONNECT=false).");
    return;
  }

  const tick = () => void attemptAutoReconnect({ reason: "watchdog" });

  setInterval(tick, INTERVAL_MS);
  console.log(
    `[wpp-reconnect] Watchdog ativo — verifica a cada ${INTERVAL_MS / 1000}s (cooldown ${COOLDOWN_MS / 1000}s).`
  );
}

export async function tryRestoreSessionAfterDeploy(): Promise<void> {
  await attemptAutoReconnect({ reason: "deploy", skipCooldown: true });
}
