import express from 'express';
import cors from 'cors';

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => cb(null, origin),
    credentials: true,
  }),
);

export default app;
