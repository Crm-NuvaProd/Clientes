import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module.js';
import { config } from './config.js';

export async function crearApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['log', 'warn', 'error'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'http:', 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        frameSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());
  app.use('/ses/eventos', express.text({ type: '*/*', limit: '256kb' }));       // SNS envía text/plain
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.enableCors({ origin: config.origenWeb, credentials: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'u/:token', method: RequestMethod.ALL }, { path: 'ses/eventos', method: RequestMethod.POST },
      { path: 'archivos/:empresa/:archivo', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  if (!config.produccion) {
    SwaggerModule.setup('api/docs', app, () =>
      SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('NuvaMail API').setVersion('1').build()));
  }

  // La misma imagen Docker sirve la web Angular compilada
  const web = path.resolve(process.env.WEB_DIST ?? path.join(import.meta.dirname, '..', 'public'));
  if (existsSync(path.join(web, 'index.html'))) {
    app.use(express.static(web, { index: false, maxAge: '1h' }));
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.method !== 'GET' || /^\/(api|u|ses|archivos)\//.test(req.path)) return next();
      res.sendFile(path.join(web, 'index.html'));
    });
  }
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await crearApp();
  await app.listen(config.puerto);
  console.log(`NuvaMail API en http://localhost:${config.puerto} (simulación: ${config.simulacion})`);
}
