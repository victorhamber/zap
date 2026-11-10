import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  APP_PUBLIC_URL: isProd ? z.string().url() : z.string().default("http://localhost:5173"),
  /** URL interna do Zap na rede Docker. O WAHA chama o webhook por aqui. Ex: http://zap-forexrendimento_zap-api:3000 */
  ZAP_INTERNAL_URL: z.string().url().optional(),
  DATABASE_URL: isProd ? z.string().min(1) : z.string().optional(),
  REDIS_URL: isProd ? z.string().min(1) : z.string().default("redis://127.0.0.1:6379"),

  JWT_SECRET: isProd ? z.string().min(32) : z.string().default("dev-jwt-secret-change-in-production-32chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  /** Nome da sessão WAHA. Não use a sessão de outro projeto. */
  WHATSAPP_SESSION: z.string().default("zap"),
  /** URL do WAHA na rede Docker. Ex.: http://zap-forexrendimento_waha:3000 */
  WAHA_BASE_URL: z.string().default("http://127.0.0.1:3000"),
  WAHA_API_KEY: z.string().default(""),
  /** false desliga a checagem automática da sessão em background */
  WPP_AUTO_RECONNECT: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  WPP_RECONNECT_INTERVAL_SEC: z.coerce.number().int().positive().default(120),
  WPP_RECONNECT_COOLDOWN_SEC: z.coerce.number().int().positive().default(180),
  /** true = ao listar sessões, remove as que não estão no painel */
  WPP_AUTO_PURGE_ORPHANS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /** false = inicia fluxos imediatamente, sem fila global */
  FLOW_DISPATCH_STAGGER: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  /** Intervalo mínimo entre inícios de fluxo (segundos) — fila global */
  FLOW_DISPATCH_MIN_SEC: z.coerce.number().int().positive().default(10),
  /** Intervalo máximo entre inícios (segundos). Valor real é aleatório entre min e max. */
  FLOW_DISPATCH_MAX_SEC: z.coerce.number().int().positive().default(30),

  /** Cadência global de e-mails (Resend) — fila separada do WhatsApp. */
  EMAIL_DISPATCH_MIN_SEC: z.coerce.number().int().positive().default(15),
  EMAIL_DISPATCH_MAX_SEC: z.coerce.number().int().positive().default(45),

  HOTMART_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Segredo compartilhado do webhook WAHA.
   * Se definido, exigimos o header x-webhook-secret — sem ele, qualquer um
   * poderia injetar mensagens no inbox e disparar fluxos.
   */
  WHATSAPP_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().default("admin@trajettu.com"),
  ADMIN_PASSWORD: z.string().min(6).default("admin123"),

  CORS_ORIGIN: z.string().default("*"),

  /** Opcional: chave dedicada para criptografar segredos no banco. Se omitida, usa JWT_SECRET. */
  AI_ENCRYPTION_KEY: z.string().optional(),
  AI_REPLY_DELAY_SEC: z.coerce.number().int().positive().default(60),
  AI_HUMAN_IDLE_SEC: z.coerce.number().int().positive().default(60),
  AI_MAX_DAILY_REPLIES: z.coerce.number().int().positive().default(200),
  /** Intervalo entre jobs de aprendizado enfileirados (backfill). Evita estourar TPM OpenAI. */
  AI_LEARN_STAGGER_MS: z.coerce.number().int().positive().default(6000),
  /** Concorrência do worker zap-ai-jobs (1 = mais seguro para rate limit). */
  AI_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  /** Máx. chamadas OpenAI por minuto no worker (BullMQ limiter). */
  AI_OPENAI_RPM_LIMIT: z.coerce.number().int().positive().default(15),
  /** Quantidade máxima de mensagens do histórico enviadas à IA por conversa. */
  AI_HISTORY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(200),
  /** Mensagens recentes enviadas literalmente (o resto fica na memória gravada). */
  AI_MEMORY_RECENT_MESSAGES: z.coerce.number().int().positive().default(12),
  /** Mínimo de mensagens novas para atualizar a memória com OpenAI. */
  AI_MEMORY_MIN_NEW_MSGS: z.coerce.number().int().positive().default(2)
}).superRefine((data, ctx) => {
  if (!isProd) return;
  if (data.ADMIN_PASSWORD === "admin123") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ADMIN_PASSWORD"],
      message:
        "Defina ADMIN_PASSWORD em produção. Sem essa variável o painel sobe com a senha padrão 'admin123' e fica aberto na internet."
    });
  }
  if (!data.WAHA_API_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WAHA_API_KEY"],
      message: "Obrigatório em produção. É a mesma chave WAHA_API_KEY do container WAHA."
    });
  }
  if (!data.WAHA_BASE_URL?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WAHA_BASE_URL"],
      message: "Obrigatório em produção. Use a URL interna do container WAHA."
    });
  }
});

export const env = EnvSchema.parse(process.env);

/** Nome da sessão WAHA deste Zap. */
export function defaultWhatsAppSession(): string {
  return env.WHATSAPP_SESSION.trim().toLowerCase();
}

export const flags = {
  isProd,
  hasDatabase: Boolean(env.DATABASE_URL),
  hasRedis: Boolean(env.REDIS_URL)
};
