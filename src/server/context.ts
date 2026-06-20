import { AsyncLocalStorage } from 'async_hooks';

export type ReqCtx = {
  requestId: string;
  username?: string;
};

export const reqCtx = new AsyncLocalStorage<ReqCtx>();
