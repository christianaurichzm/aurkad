import express from 'express';
import path from 'path';
import { serveGame } from './gameController';

const app = express();

app.use(express.static(path.join(__dirname, '../../public')));
app.get('*', serveGame);

export default app;
