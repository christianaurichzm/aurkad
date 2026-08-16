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

/** Leaf action: always succeeds after running fn. */
export const act =
  <C>(fn: (ctx: C) => void): BtNode<C> =>
  (ctx) => {
    fn(ctx);
    return 'success';
  };
