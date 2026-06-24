export type BtStatus = 'success' | 'failure' | 'running';
export type BtNode<C> = (ctx: C) => BtStatus;

/** Tries children left-to-right, stops at first non-failure (logical OR). */
export const selector =
  <C>(...nodes: BtNode<C>[]): BtNode<C> =>
  (ctx) => {
    for (const node of nodes) {
      const s = node(ctx);
      if (s !== 'failure') return s;
    }
    return 'failure';
  };

/** Runs children left-to-right, stops at first non-success (logical AND). */
export const sequence =
  <C>(...nodes: BtNode<C>[]): BtNode<C> =>
  (ctx) => {
    for (const node of nodes) {
      const s = node(ctx);
      if (s !== 'success') return s;
    }
    return 'success';
  };

/** Leaf condition: success when fn returns true, failure otherwise. */
export const cond =
  <C>(fn: (ctx: C) => boolean): BtNode<C> =>
  (ctx) =>
    fn(ctx) ? 'success' : 'failure';

/** Leaf action: always succeeds after running fn. */
export const act =
  <C>(fn: (ctx: C) => void): BtNode<C> =>
  (ctx) => {
    fn(ctx);
    return 'success';
  };
