import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { Prisma, PrismaClient } from '../../generated/prisma/client';

// The Neon serverless driver talks WebSockets. In the browser that comes for
// free; under Node it needs an explicit implementation.
neonConfig.webSocketConstructor = ws;

function createAdapter() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. The Prisma client cannot start without it.',
    );
  }

  // Neon in production (serverless driver over WebSockets); a plain Postgres
  // connection for local development against Docker.
  if (/\.neon\.tech/.test(connectionString)) {
    return new PrismaNeon({ connectionString });
  }
  return new PrismaPg({ connectionString });
}

/**
 * Prisma 7 exports PrismaClient as an interface with a *generic* construct
 * signature. TypeScript cannot infer the instance type through `extends`, so
 * a subclass silently loses every model delegate — `this.user.findFirst()`
 * resolves to an error type that `tsc` will not report because the generated
 * files carry `@ts-nocheck`.
 *
 * Pinning the constructor to the default type arguments restores full typing
 * on the subclass. Verify with: `const x: string = (await p.user.findFirst())!.emailVerified`
 * — that must be a type error.
 */
const PrismaClientBase = PrismaClient as unknown as new (
  options: Prisma.PrismaClientOptions,
) => PrismaClient;

@Injectable()
export class PrismaService
  extends PrismaClientBase
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: createAdapter(),
      log: ['warn', 'error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
