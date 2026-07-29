// One headless player: registers, logs in, holds a socket open and drives
// input like a real client, over the same HTTP and WebSocket path.

import WebSocket from 'ws';
import type { BotSample } from './report.js';
import type { BotBehavior } from './scenarios.js';

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

export interface BotOptions {
  baseUrl: string;
  username: string;
  password: string;
  behavior: BotBehavior;
  /** Ticks between input bursts, in ms. */
  actionIntervalMs: number;
}

export class LoadBot {
  private ws: WebSocket | null = null;
  private cookie = '';
  private socketOpenedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private heldKey: string | null = null;
  private closed = false;

  readonly sample: BotSample = {
    bytesReceived: 0,
    messagesReceived: 0,
    worldUpdates: 0,
    authMs: 0,
    firstStateMs: 0,
    errors: 0,
  };

  constructor(private readonly opts: BotOptions) {}

  /** Registers if needed, logs in, and opens the socket. */
  async connect(): Promise<void> {
    const authStarted = Date.now();
    await this.ensureAccount();
    await this.login();
    this.sample.authMs = Date.now() - authStarted;

    await this.openSocket();
  }

  private async ensureAccount(): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.opts.username,
        password: this.opts.password,
      }),
    });
    // 409 means the account exists from an earlier run, which skips the
    // password hash that would otherwise dominate the connect phase.
    if (!res.ok && res.status !== 409) {
      throw new Error(`register failed: ${res.status}`);
    }
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.opts.username,
        password: this.opts.password,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`login failed: ${res.status} ${body.slice(0, 120)}`);
    }

    const setCookie = res.headers.getSetCookie?.() ?? [];
    this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    if (!this.cookie) throw new Error('login returned no session cookie');
  }

  private openSocket(): Promise<void> {
    const wsUrl = this.opts.baseUrl.replace(/^http/, 'ws') + '/ws';

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { headers: { Cookie: this.cookie } });
      this.ws = ws;

      const failFast = (err: Error) => {
        this.sample.errors++;
        reject(err);
      };

      ws.on('open', () => {
        this.socketOpenedAt = Date.now();
        resolve();
      });
      ws.on('error', failFast);
      ws.on('message', (data: WebSocket.RawData) => this.onMessage(data));
      ws.on('close', () => {
        this.stopActing();
        if (!this.closed) this.sample.errors++;
      });
    });
  }

  private onMessage(data: WebSocket.RawData): void {
    const text = data.toString();
    this.sample.bytesReceived += Buffer.byteLength(text);
    this.sample.messagesReceived++;

    // Only parse enough to classify the frame; decoding every frame would make
    // the harness the bottleneck.
    if (text.includes('"type":"worldUpdate"')) {
      if (this.sample.firstStateMs === 0) {
        // First authoritative state is when the player is really in the world.
        this.sample.firstStateMs = Date.now() - this.socketOpenedAt;
      }
      this.sample.worldUpdates++;
    }
  }

  /** Starts driving input for this bot's behaviour. */
  startActing(random: () => number): void {
    if (this.opts.behavior === 'idle') return;

    this.timer = setInterval(() => {
      try {
        this.act(random);
      } catch {
        this.sample.errors++;
      }
    }, this.opts.actionIntervalMs);
    this.timer.unref?.();
  }

  private act(random: () => number): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (this.opts.behavior === 'fight' && random() < 0.4) {
      // The server ignores a press of a key it still holds, so a bot that
      // never releases attacks only once.
      this.send({
        type: 'keyboard',
        keyboardAction: { key: 'Control', type: 'press' },
      });
      this.send({
        type: 'keyboard',
        keyboardAction: { key: 'Control', type: 'release' },
      });
      return;
    }

    // Release the previous key first, as a real client does.
    if (this.heldKey) {
      this.send({
        type: 'keyboard',
        keyboardAction: { key: this.heldKey, type: 'release' },
      });
    }
    const key = ARROWS[Math.floor(random() * ARROWS.length)]!;
    this.heldKey = key;
    this.send({
      type: 'keyboard',
      keyboardAction: { key, type: 'press' },
    });
  }

  private send(message: unknown): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private stopActing(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drops the socket without counting it as a failure (used by reconnect). */
  drop(): void {
    this.stopActing();
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.closed = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopActing();
    this.ws?.close();
    this.ws = null;
  }
}
