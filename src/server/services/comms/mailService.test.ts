import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import net from 'node:net';

// The relay's address is known once the fake server below has a port, and
// the transport reads it on the first send, which comes after.
const mockSmtp = { url: '' };
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config.js')>();
  return {
    config: {
      ...actual.config,
      mail: {
        ...actual.config.mail,
        transport: 'smtp',
        from: 'game@example.com',
        get smtpUrl() {
          return mockSmtp.url;
        },
      },
    },
  };
});

import { mailReachesPlayers, sendMail } from './mailService.js';

/**
 * Enough SMTP to be talked to. Mocking nodemailer would test that a mock was
 * called; what is worth proving is that an SMTP_URL becomes bytes on a
 * socket, the whole of this deployment step.
 */
const spoken: string[] = [];
let relay: net.Server;

beforeAll(async () => {
  relay = net.createServer((socket) => {
    let body = '';
    let inData = false;
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      if (inData) {
        body += chunk.toString();
        if (!body.includes('\r\n.\r\n')) return;
        inData = false;
        spoken.push(body);
        socket.write('250 OK\r\n');
        return;
      }
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        if (line.startsWith('EHLO') || line.startsWith('HELO')) {
          socket.write('250-fake\r\n250 SIZE 10240000\r\n');
        } else if (line.startsWith('DATA')) {
          inData = true;
          socket.write('354 Send it\r\n');
        } else if (line.startsWith('QUIT')) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          spoken.push(line);
          socket.write('250 OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const address = relay.address() as net.AddressInfo;
  mockSmtp.url = `smtp://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    relay.close(() => resolve());
  });
});

describe('sending mail', () => {
  it('reaches players once there is a relay', () => {
    expect(mailReachesPlayers()).toBe(true);
  });

  it('hands the message to the relay, from the operator', async () => {
    const ok = await sendMail({
      to: 'alice@example.com',
      subject: 'Confirm your address',
      text: 'http://localhost:8080/email/confirm?token=abc',
    });

    expect(ok).toBe(true);
    const conversation = spoken.join('\n');
    expect(conversation).toContain('game@example.com');
    expect(conversation).toContain('alice@example.com');
    expect(conversation).toContain('/email/confirm?token=abc');
  });

  // A relay that is down is a fact about the deployment, not a failed request:
  // the caller has already minted its token, and a throw here would turn "we
  // could not send it" into a 500 on a screen that was doing fine.
  it('reports a relay that is not there rather than throwing', async () => {
    await new Promise<void>((resolve) => {
      relay.close(() => resolve());
    });

    expect(
      await sendMail({ to: 'a@example.com', subject: 'Hi', text: 'there' }),
    ).toBe(false);
  });
});
