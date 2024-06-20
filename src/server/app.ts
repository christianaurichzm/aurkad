import express from 'express';
import path from 'path';
import { Request, Response } from 'express';

const app = express();
const publicFolder = '../../public';

const serveGame = (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, `${publicFolder}/index.html`));
};

app.use(express.static(path.join(__dirname, publicFolder)));
app.get('*', serveGame);

export default app;
