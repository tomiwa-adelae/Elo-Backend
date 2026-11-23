/**
 * Prisma client for standalone scripts (seed, create-admin). Mirrors
 * PrismaService: Neon's serverless driver for *.neon.tech, plain Postgres
 * otherwise (local Docker).
 */
import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { PrismaClient } from '../generated/prisma/client';

neonConfig.webSocketConstructor = ws;

export function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const adapter = /\.neon\.tech/.test(connectionString)
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}
