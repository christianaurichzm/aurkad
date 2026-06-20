import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { requestLoggerMiddleware } from './http/requestLogger.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(requestLoggerMiddleware);
  app.use(express.json({ limit: config.http.jsonBodyLimit }));
  app.use(cors(config.cors.options));

  return app;
}

export default createApp();
