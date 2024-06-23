import express from 'express';
import { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());
const publicFolder = '../../public';

const serveGame = (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, `${publicFolder}/index.html`));
};

app.use(express.static(path.join(__dirname, publicFolder)));
app.get('*', serveGame);

export default app;
