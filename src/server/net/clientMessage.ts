import { z } from 'zod';
import { Key } from '../../shared/types.js';

const KeySchema = z.enum(Object.values(Key) as [Key, ...Key[]]);

const KeyboardMessageSchema = z.object({
  type: z.literal('keyboard'),
  keyboardAction: z.object({
    key: KeySchema,
    type: z.enum(['press', 'release']),
  }),
  seq: z.number().int().optional(),
});

const ItemMessageSchema = z.object({
  type: z.literal('item'),
  item: z.number().int().nonnegative(),
  action: z.enum(['use', 'drop']),
  quantity: z.number().int().positive().optional(),
});

const MAX_CHAT_LENGTH = 200;

const ChatMessageSchema = z.object({
  type: z.literal('chat'),
  message: z.string().min(1).max(MAX_CHAT_LENGTH),
  scope: z.enum(['player', 'map', 'global']),
});

const MAX_CHANNEL_LENGTH = 64;

const CustomMessageSchema = z.object({
  type: z.literal('custom'),
  channel: z.string().min(1).max(MAX_CHANNEL_LENGTH),
  // Opaque to the engine. The receiving script must treat it as untrusted
  // client input and validate before use.
  payload: z.unknown().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  KeyboardMessageSchema,
  ItemMessageSchema,
  ChatMessageSchema,
  CustomMessageSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
