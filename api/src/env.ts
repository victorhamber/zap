import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const EnvSchema = z.object({
  APP_PUBLIC_URL: isProd ? z.string().url() : z.string().default("http://localhost:5173"),
  /** URL interna do app Zap na rede Docker (WPP baixa mídia e chama webhook). Ex: http://zap:3000 */
  ZAP_INTERNAL_URL: z.string().url().optional(),
  DATABASE_URL: isProd ? z.string().min(1) : z.string().optional(),
  REDIS_URL: isProd ? z.string().min(1) : z.string().default("redis://127.0.0.1:6379"),

  JWT_SECRET: isProd ? z.string().min(32) : z.string().default("dev-jwt-secret-change-in-production-32chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  WPP_BASE_URL: z.string().default("https://wpp.trajettu.com"),
  /** URL rede interna (EasyPanel). Ex: http://nome-servico-wpp:21465 */
  WPP_INTERNAL_URL: z.string().optional(),
  WPP_SESSION: z.string().default("autofintech"),
  WPP_SECRET_KEY: isProd ? z.string().min(8) : z.string().default("dev-secret-key"),
  /** false desliga reconexão automática em background */
  WPP_AUTO_RECONNECT: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  WPP_RECONNECT_INTERVAL_SEC: z.coerce.number().int().positive().default(120),
  WPP_RECONNECT_COOLDOWN_SEC: z.coerce.number().int().positive().default(180),
  /** true = start-session HTTP bloqueia até escanear (padrão WPP 60s autoClose). false = retorna rápido e o painel faz polling do QR. */
  WPP_START_WAIT_QR: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  HOTMART_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().default("admin@trajettu.com"),
  ADMIN_PASSWORD: z.string().min(6).default("admin123"),

  CORS_ORIGIN: z.string().default("*")
});

export const env = EnvSchema.parse(process.env);
export const flags = {
  isProd,
  hasDatabase: Boolean(env.DATABASE_URL),
  hasRedis: Boolean(env.REDIS_URL)
};
