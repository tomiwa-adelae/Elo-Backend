import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Walk up from the compiled file until we find backend/.env. The depth differs
// between `nest start` (dist/main.js) and a rootDir that keeps the src folder
// (dist/src/main.js), so hardcoding ../../ breaks in one of the two.
(() => {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    dir = path.dirname(dir);
  }
  // Fall back to CWD resolution; ConfigModule will also try.
  dotenv.config();
})();
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import type { IncomingMessage } from 'http';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Capture raw body for webhook signature verification, then parse as JSON.
  // Must be registered before any other body-consuming middleware.
  app.use(
    json({
      limit: '10mb',
      verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  const allowedOrigins = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const port = process.env.PORT || 8000;
  const isDev = process.env.NODE_ENV !== 'production';

  app.enableCors({
    origin: (origin, callback) => {
      // Allow server-to-server / SSR requests (no origin header) - testing this comment
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Allow Swagger UI (same host as the API) in non-production
      if (isDev && origin === `http://localhost:${port}`)
        return callback(null, true);
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
  });

  // Webhooks sit outside /api because the URL is registered with the payment
  // provider and should not move if the API prefix ever changes. The wildcard
  // matters: excluding bare 'webhook' would not cover 'webhook/paystack'.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'webhook', method: RequestMethod.ALL },
      { path: 'webhook/*path', method: RequestMethod.ALL },
    ],
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  await app.listen(port);
}

void bootstrap();
