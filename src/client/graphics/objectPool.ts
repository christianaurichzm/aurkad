export class ObjectPool<T extends { active: boolean }> {
  private readonly pool: T[];

  constructor(size: number, factory: () => T) {
    this.pool = Array.from({ length: size }, factory);
  }

  acquire(): T | null {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) return this.pool[i];
    }
    return null;
  }

  /** Iterates active items; set item.active = false in fn to recycle one. */
  forEach(fn: (item: T) => void): void {
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) fn(this.pool[i]);
    }
  }

  activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) n++;
    }
    return n;
  }
}
