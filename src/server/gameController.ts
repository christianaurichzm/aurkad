import { Request, Response } from 'express';
import path from 'path';

export const serveGame = (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
};
