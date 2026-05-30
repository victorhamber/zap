/**
 * Fachada WhatsApp: WPPConnect (legado) ou Evolution API (WHATSAPP_PROVIDER=evolution).
 */
import { env, defaultWhatsAppSession } from "../../env.js";
import * as wppconnect from "../wppconnect.js";
import * as evolution from "./evolution.js";

export const isEvolution = env.WHATSAPP_PROVIDER === "evolution";

const p = isEvolution ? evolution : wppconnect;

export const MSG_NO_DEVICE = p.MSG_NO_DEVICE;
export const MSG_NO_SESSION_CLOSE = p.MSG_NO_SESSION_CLOSE;
export const MSG_NO_SESSION_LOGOUT = p.MSG_NO_SESSION_LOGOUT;
export const MSG_QR_TIMEOUT = p.MSG_QR_TIMEOUT;
export const MSG_WPP_NO_QR = p.MSG_WPP_NO_QR;
export const MSG_WPP_AGGREGATE_BOOT = p.MSG_WPP_AGGREGATE_BOOT;
export const MSG_BROWSER_PROFILE_LOCK = p.MSG_BROWSER_PROFILE_LOCK;

export const isWppNetworkError = p.isWppNetworkError;
export const isWppBrowserLockError = p.isWppBrowserLockError;
export const isWppBrokenClientError = p.isWppBrokenClientError;
export const mapWppErrorMessage = p.mapWppErrorMessage;
export const isDisconnectedState = p.isDisconnectedState;
export const isPhoneUnlinkedStatus = p.isPhoneUnlinkedStatus;
export const clearWppStoredAuth = p.clearWppStoredAuth;
export const isPairingQuiet = p.isPairingQuiet;
export const isStablePhoneConnectionState = p.isStablePhoneConnectionState;
export const markSessionRequiresQr = p.markSessionRequiresQr;
export const handleWppLifecycleWebhook = p.handleWppLifecycleWebhook;
export const httpErrorMeansNoSession = p.httpErrorMeansNoSession;
export const formatWppError = p.formatWppError;
export const getActiveWppSessionName = p.getActiveWppSessionName;
export const setActiveSession = p.setActiveSession;
export const refreshWppToken = p.refreshWppToken;
export const getWppToken = p.getWppToken;
export const sendText = p.sendText;
export const sendImage = p.sendImage;
export const sendVideo = p.sendVideo;
export const sendAudio = p.sendAudio;
export const checkConnection = p.checkConnection;
export const isWppConnectedState = p.isWppConnectedState;
export const parseConnectionCheck = p.parseConnectionCheck;
export const sessionNeedsQr = p.sessionNeedsQr;
export const verifyActiveSession = p.verifyActiveSession;
export const registerInboundWebhook = p.registerInboundWebhook;
export const getInboundWebhookDiagnostics = p.getInboundWebhookDiagnostics;
export const extractQrImage = p.extractQrImage;
export const extractSessionState = p.extractSessionState;
export const startSession = p.startSession;
export const getQrCode = p.getQrCode;
export const fetchQrFromSessionStatus = p.fetchQrFromSessionStatus;
export const waitForQrImageAfterStart = p.waitForQrImageAfterStart;
export const getSessionStatus = p.getSessionStatus;
export const closeSession = p.closeSession;
export const logoutSession = p.logoutSession;
export const parseWppServerSessionNames = p.parseWppServerSessionNames;
export const listServerSessions = p.listServerSessions;
export const getConnectedOwnerDigits = isEvolution
  ? evolution.getConnectedOwnerDigits
  : async (): Promise<string | null> => null;
export const clearEvolutionInstanceCache = isEvolution
  ? evolution.clearEvolutionInstanceCache
  : (): void => {};
export const getConnectedInstanceProfile = isEvolution
  ? evolution.getConnectedInstanceProfile
  : async () => ({
      instanceName: defaultWhatsAppSession(),
      profileName: null,
      profilePictureUrl: null,
      phone: null,
      connected: false
    });
export const purgeWppSessionFromServer = p.purgeWppSessionFromServer;
export const purgeOrphanWppSessions = p.purgeOrphanWppSessions;
export const runWppDiagnostics = p.runWppDiagnostics;
export const validateProxyPath = p.validateProxyPath;
export const callSessionApi = p.callSessionApi;
