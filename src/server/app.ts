import express from 'express';
import cors from 'cors';
import { config } from './config.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: config.http.jsonBodyLimit }));
  app.use(cors(config.cors.options));

  return app;
}

export default createApp();
