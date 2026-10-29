import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config';

export interface AppOptions {
  webRoot?: string;
  shutdownHooks?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const webRoot = options.webRoot ? resolve(options.webRoot) : undefined;
  if (
    webRoot &&
    (!existsSync(join(webRoot, 'index.html')) ||
      !statSync(webRoot).isDirectory())
  ) {
    throw new Error('ZoHome 前端资源缺失，请重新解压或下载完整程序');
  }
  // Explicit adapter also avoids Nest dynamically locating a platform inside a bundled executable.
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), {
    logger: ['error', 'warn', 'log'],
  });
  const config = app.get(AppConfig);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use(
    (
      _: unknown,
      res: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    origin: new URL(config.frontendUrl).origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  if (webRoot) {
    // Register before Nest routes, but never let SPA fallback intercept any /api request.
    const staticFiles = express.static(webRoot, {
      index: false,
      dotfiles: 'deny',
      fallthrough: true,
    });
    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        staticFiles(req, res, (error?: unknown) => {
          if (error) return next(error);
          if (!req.accepts('html') || /\.[^/]+$/.test(req.path)) return next();
          res.sendFile(join(webRoot, 'index.html'));
        });
      },
    );
  }
  if (options.shutdownHooks !== false) app.enableShutdownHooks();
  return app;
}
