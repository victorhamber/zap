import { PrismaClient } from "@prisma/client";

export const prisma: PrismaClient | null = process.env.DATABASE_URL
  ? new PrismaClient()
  : null;
