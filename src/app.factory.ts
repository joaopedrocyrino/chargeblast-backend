import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import type { AppConfig } from './config/app-config.js';

const API_PREFIX = 'api/v1';

/** Applies the global HTTP configuration shared by main.ts and tests. */
function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.useGlobalFilters(new HttpExceptionFilter());
  // The only body the API accepts is a small create-payment form.
  app.useBodyParser('json', { limit: '16kb' });
  if (config.corsOrigins.length > 0) {
    // The dashboard calls the API from its own domain in production.
    app.enableCors({
      origin: [...config.corsOrigins],
      methods: ['GET', 'POST'],
      allowedHeaders: ['Accept', 'Content-Type'],
      maxAge: 600,
    });
  }
  if (config.nodeEnv !== 'test') {
    const logger = new Logger('HTTP');
    app.use((request: Request, response: Response, next: NextFunction) => {
      const started = performance.now();
      response.on('finish', () => {
        const ms = (performance.now() - started).toFixed(1);
        logger.log(`${request.method} ${request.originalUrl} ${response.statusCode} ${ms}ms`);
      });
      next();
    });
  }
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.nodeEnv === 'test' ? false : ['log', 'warn', 'error'],
  });
  configureApp(app, config);
  app.enableShutdownHooks();
  return app;
}
