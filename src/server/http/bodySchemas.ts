import { z } from 'zod';
import type { Response } from 'express';
import { Access } from '../../shared/types.js';
import { USERNAME_MAX_LENGTH } from '../../shared/constants.js';
import { gameConfig } from '../gameConfig.js';
import { registerStrings } from '../engine/i18n.js';
import {
  BorderLinksSchema,
  MapTypeSchema,
  PvpMoraleSchema,
  TileSchema,
} from '../services/world/mapService.js';

const AccessSchema = z.nativeEnum(Access);

// Auth
// A second factor: an authenticator's six digits or a printed recovery
// code. Named `totpToken`, not `code`, so the audit trail's redaction of
// `token` catches it; `code` is what a script body calls its source.
const TotpToken = z.string().min(6).max(32);

export const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // "Remember me" on the login screen. Absent means the cookie dies with the
  // browser, which is the right default for a game: closing the client should
  // not leave the next person at that machine holding the character.
  remember: z.boolean().optional(),
  // Absent on the first attempt: the screen has no way to know an account is
  // enrolled until it asks, and saying so before the password is checked
  // answers "does this account exist" for free.
  totpToken: TotpToken.optional(),
});

// Enrolling a second factor. The current password is asked for the same reason
// changing one asks: an open session on a shared machine must not be enough to
// bind somebody else's account to a phone.
export const TwoFactorSetupBodySchema = z.object({
  currentPassword: z.string().min(1),
});

export const TwoFactorEnableBodySchema = z.object({
  totpToken: TotpToken,
});

// Turning it off asks for both halves, because either one alone is exactly the
// case the factor exists for: a stolen password, or a session left open.
export const TwoFactorDisableBodySchema = z.object({
  currentPassword: z.string().min(1),
  totpToken: TotpToken,
});

// A new password, wherever it is being set, under the game's rule (game.json
// `account`). The messages are sentences because the sign-up form shows them
// as they come, translated by the route; the numbers are fixed at boot, so the
// table can hold the sentences whole.
const { account } = gameConfig;
const passwordShort = `Passwords are at least ${account.passwordMinLength} characters`;
const passwordLong = 'That password is too long';
const nameShort = `Names are at least ${account.usernameMinLength} characters`;
const nameLong = `Names are at most ${account.usernameMaxLength} characters`;
const nameChars = 'That name has characters this game does not allow';
const nameReserved = 'That name is reserved';
registerStrings({
  pt: {
    [passwordShort]: `Senhas têm pelo menos ${account.passwordMinLength} caracteres`,
    [passwordLong]: 'Essa senha é longa demais',
    [nameShort]: `Nomes têm pelo menos ${account.usernameMinLength} caracteres`,
    [nameLong]: `Nomes têm no máximo ${account.usernameMaxLength} caracteres`,
    [nameChars]: 'Esse nome tem caracteres que este jogo não aceita',
    [nameReserved]: 'Esse nome é reservado',
  },
  es: {
    [passwordShort]: `Las contraseñas tienen al menos ${account.passwordMinLength} caracteres`,
    [passwordLong]: 'Esa contraseña es demasiado larga',
    [nameShort]: `Los nombres tienen al menos ${account.usernameMinLength} caracteres`,
    [nameLong]: `Los nombres tienen como máximo ${account.usernameMaxLength} caracteres`,
    [nameChars]: 'Ese nombre tiene caracteres que este juego no acepta',
    [nameReserved]: 'Ese nombre está reservado',
  },
});

// bcrypt reads no further than 72 bytes. Past them two passwords are the same
// one, and a change that only touches the end leaves the old one working.
const NewPassword = z
  .string()
  .min(account.passwordMinLength, passwordShort)
  .refine((password) => Buffer.byteLength(password) <= 72, passwordLong);

export const RegisterBodySchema = z.object({
  username: z
    .string()
    .min(account.usernameMinLength, nameShort)
    .max(account.usernameMaxLength, nameLong)
    .regex(new RegExp(account.usernamePattern, 'u'), nameChars)
    // Modules and scripts key plain objects by player name, where `__proto__`
    // or `constructor` would reach the object every other entry inherits from.
    .refine((name) => !(name in Object.prototype), nameReserved),
  password: NewPassword,
});

export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: NewPassword,
});

export const ResetRequestBodySchema = z.object({
  username: z.string().min(1).max(USERNAME_MAX_LENGTH),
});

// Setting the address a reset link goes to. The current password is asked
// for as when changing one: a session left open on a shared machine must
// not be enough to send somebody's account recovery to a new inbox.
export const SetEmailBodySchema = z.object({
  currentPassword: z.string().min(1),
  email: z.email().max(200),
});

export const ResetConfirmBodySchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: NewPassword,
});

// Mod
export const PlayerNameBodySchema = z.object({ playerName: z.string().min(1) });

export const ChangeSpriteBodySchema = z.object({
  spriteId: z.number().int().nonnegative(),
});

export const BanBodySchema = z.object({
  playerName: z.string().min(1),
  reason: z.string().optional(),
  until: z.number().int().positive().optional(),
});

export const SetSpriteBodySchema = z.object({
  playerName: z.string().min(1),
  spriteId: z.number().int().nonnegative(),
});

export const SetAccessBodySchema = z.object({
  playerName: z.string().min(1),
  accessLevel: AccessSchema,
});

export const WarpPlayerBodySchema = z.object({
  playerName: z.string().min(1),
  mapId: z.string().min(1),
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
});

export const SetMyAccessBodySchema = z.object({ accessLevel: AccessSchema });

// Content
export const SaveMapBodySchema = z.object({
  mapId: z.string().min(1),
  tiles: z.array(z.array(TileSchema)),
  name: z.string().min(1),
  type: MapTypeSchema,
  orientation: z.enum(['orthogonal', 'isometric']).optional(),
  pvp: PvpMoraleSchema.optional(),
  music: z.string().optional(),
});

/**
 * A crash in a player's browser, reported by the client.
 *
 * Every field is capped rather than merely typed: this is the one endpoint that
 * accepts free text from an unauthenticated caller and writes it to the log an
 * operator reads. A stack is long, so 4 KB; nothing useful is past that.
 */
export const ClientErrorBodySchema = z.object({
  kind: z.enum(['error', 'unhandledrejection']),
  message: z.string().min(1).max(500),
  stack: z.string().max(4000).optional(),
  /** Where in the client it happened, not where it was sent from. */
  source: z.string().max(500).optional(),
});

export const CreateMapBodySchema = z.object({
  name: z.string().min(1),
  type: MapTypeSchema,
  orientation: z.enum(['orthogonal', 'isometric']).optional(),
  cols: z.number().int().min(1).max(200).optional(),
  rows: z.number().int().min(1).max(200).optional(),
});

export const UpdateMapBodySchema = z.object({
  name: z.string().min(1).optional(),
  type: MapTypeSchema.optional(),
  orientation: z.enum(['orthogonal', 'isometric']).optional(),
  pvp: PvpMoraleSchema.optional(),
  music: z.string().optional(),
  instanced: z.boolean().optional(),
  borderLinks: BorderLinksSchema,
});

export const ResizeMapBodySchema = z.object({
  cols: z.number().int().min(1).max(200),
  rows: z.number().int().min(1).max(200),
});

export const BuyShopItemBodySchema = z.object({
  shopId: z.string().min(1),
  itemId: z.number().int().nonnegative(),
});

export const ConsoleCommandBodySchema = z.object({
  line: z.string().min(1).max(500),
});

// Scripts (Monaco editor)
export const ScriptContentBodySchema = z.object({
  content: z.string().max(500_000),
});

export const CreateScriptBodySchema = z.object({
  name: z.string().min(1).max(120),
  content: z.string().max(500_000).optional(),
});

export const AssignPointsBodySchema = z.object({
  vitality: z.number().int().nonnegative().default(0),
  attack: z.number().int().nonnegative().default(0),
  strength: z.number().int().nonnegative().default(0),
  defense: z.number().int().nonnegative().default(0),
  agility: z.number().int().nonnegative().default(0),
});

export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  res: Response,
): z.output<S> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ error: result.error.flatten() });
    return null;
  }
  return result.data;
}
