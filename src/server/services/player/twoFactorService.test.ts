import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import mongoose from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startMemoryMongo } from '../../../test/mongo.js';
import TwoFactorModel from '../../model/TwoFactor.js';
import {
  checkSecondFactor,
  disableTwoFactor,
  enableTwoFactor,
  newSecret,
  otpauthUrl,
  stepAt,
  totpCode,
  twoFactorStatus,
  verifyTotp,
} from './twoFactorService.js';

// "12345678901234567890" in base32, the seed RFC 6238 publishes its
// vectors against. The RFC prints eight digits; an authenticator app shows
// the last six of the same number, which is what this returns.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP against the RFC 6238 vectors', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('at T=%i shows %s', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(expected);
  });
});

describe('verifyTotp', () => {
  const at = 1111111109 * 1000;

  it('accepts the code of the moment and reports its step', () => {
    expect(verifyTotp(RFC_SECRET, '081804', at)).toBe(stepAt(at));
  });

  it('accepts one step of drift either side, and no more', () => {
    const before = totpCode(RFC_SECRET, at - 30_000);
    const after = totpCode(RFC_SECRET, at + 30_000);
    const wayOff = totpCode(RFC_SECRET, at + 120_000);

    expect(verifyTotp(RFC_SECRET, before, at)).toBe(stepAt(at) - 1);
    expect(verifyTotp(RFC_SECRET, after, at)).toBe(stepAt(at) + 1);
    expect(verifyTotp(RFC_SECRET, wayOff, at)).toBeNull();
  });

  it('refuses a step already spent, which is what stops a replay', () => {
    const step = stepAt(at);
    expect(verifyTotp(RFC_SECRET, '081804', at, step)).toBeNull();
    // The window still moves forward: the next code is not refused with it.
    expect(
      verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at + 30_000), at, step),
    ).toBe(step + 1);
  });

  it('reads a code with spaces in it, as apps display them', () => {
    expect(verifyTotp(RFC_SECRET, '081 804', at)).toBe(stepAt(at));
  });

  it('refuses anything that is not six digits, and a broken secret', () => {
    expect(verifyTotp(RFC_SECRET, '81804', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBeNull();
    expect(verifyTotp('not base32!', '081804', at)).toBeNull();
  });
});

describe('enrollment material', () => {
  it('mints a 160-bit base32 secret, different every time', () => {
    const first = newSecret();
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(first).not.toBe(newSecret());
  });

  it('round-trips its own secret through the code it generates', () => {
    const secret = newSecret();
    expect(verifyTotp(secret, totpCode(secret))).not.toBeNull();
  });

  it('describes itself to an authenticator app', () => {
    const url = new URL(otpauthUrl('Boss', RFC_SECRET));
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toContain(':Boss');
    expect(url.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
  });
});

describe('the enrolled account', () => {
  let mongod: MongoMemoryServer;

  // The clock is held rather than left to run: every assertion here is about
  // which 30-second step a code belongs to, and a test that straddles a step
  // boundary while it runs fails for a reason that has nothing to do with the
  // code under it.
  let now = 1_700_000_000_000;
  const later = () => (now += 30_000);

  beforeAll(async () => {
    mongod = await startMemoryMongo();
    await mongoose.connect(mongod.getUri());
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await TwoFactorModel.deleteMany({});
  });

  const enroll = async (username: string) => {
    const secret = newSecret();
    const result = await enableTwoFactor(username, secret, totpCode(secret));
    if (!result.ok) throw new Error('enrollment should have been accepted');
    return { secret, recoveryCodes: result.recoveryCodes };
  };

  it('refuses to enroll from a code the account cannot produce', async () => {
    const result = await enableTwoFactor('Boss', newSecret(), '000000');

    expect(result).toEqual({ ok: false, reason: 'wrong-code' });
    expect(await twoFactorStatus('Boss')).toEqual({
      enabled: false,
      recoveryLeft: 0,
    });
  });

  it('enrolls, prints ten codes, and reports itself on', async () => {
    const { recoveryCodes } = await enroll('Boss');

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(await twoFactorStatus('Boss')).toEqual({
      enabled: true,
      recoveryLeft: 10,
    });
  });

  it('will not enroll over a factor that is on', async () => {
    const { secret } = await enroll('Boss');
    const other = newSecret();

    expect(await enableTwoFactor('Boss', other, totpCode(other))).toEqual({
      ok: false,
      reason: 'already-enabled',
    });
    expect((await TwoFactorModel.findOne({ username: 'Boss' }))?.secret).toBe(
      secret,
    );
  });

  it('answers ok for an account that never enrolled', async () => {
    expect(await checkSecondFactor('Nobody', undefined)).toBe('ok');
  });

  it('asks for a code, then takes the right one and refuses the wrong', async () => {
    const { secret } = await enroll('Boss');
    later();

    expect(await checkSecondFactor('Boss', undefined)).toBe('required');
    expect(await checkSecondFactor('Boss', '000000')).toBe('wrong');
    expect(await checkSecondFactor('Boss', totpCode(secret))).toBe('ok');
  });

  it('will not take the same code twice', async () => {
    const { secret } = await enroll('Boss');
    later();
    const code = totpCode(secret);

    expect(await checkSecondFactor('Boss', code)).toBe('ok');
    expect(await checkSecondFactor('Boss', code)).toBe('wrong');
  });

  // Sequentially the second read already sees the step the first one moved.
  // Both of these read the account before either writes it, which is what a
  // stolen code offered twice at once looks like.
  it('will not take the same code twice at the same time', async () => {
    const { secret } = await enroll('Boss');
    later();
    const code = totpCode(secret);

    const results = await Promise.all([
      checkSecondFactor('Boss', code),
      checkSecondFactor('Boss', code),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
  });

  it('will not take the code that enrolled the account', async () => {
    const { secret } = await enroll('Boss');

    expect(await checkSecondFactor('Boss', totpCode(secret))).toBe('wrong');
  });

  it('spends a recovery code once and leaves the others', async () => {
    const { recoveryCodes } = await enroll('Boss');
    const [first, second] = recoveryCodes as [string, string];

    expect(await checkSecondFactor('Boss', first)).toBe('ok');
    expect(await checkSecondFactor('Boss', first)).toBe('wrong');
    expect((await twoFactorStatus('Boss')).recoveryLeft).toBe(9);
    expect(await checkSecondFactor('Boss', second.toLowerCase())).toBe('ok');
  });

  it('spends a recovery code once even offered twice at the same time', async () => {
    const { recoveryCodes } = await enroll('Boss');
    const [first] = recoveryCodes as [string];

    const results = await Promise.all([
      checkSecondFactor('Boss', first),
      checkSecondFactor('Boss', first),
    ]);

    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect((await twoFactorStatus('Boss')).recoveryLeft).toBe(9);
  });

  it('forgets the secret when it is turned off', async () => {
    await enroll('Boss');

    expect(await disableTwoFactor('Boss')).toBe(true);
    expect(await disableTwoFactor('Boss')).toBe(false);
    expect(await checkSecondFactor('Boss', undefined)).toBe('ok');
  });
});
