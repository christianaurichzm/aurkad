import { Access } from '../../../../shared/types';
import { httpClient } from './httpClient';

export const modKick = async (playerName: string) =>
  httpClient<Response>('/mod/kick', {
    method: 'POST',
    body: { playerName },
  });

export const modBan = async (
  playerName: string,
  reason = '',
  until?: number,
) => {
  return httpClient<Response>('/mod/ban', {
    method: 'POST',
    body: { playerName, reason, until },
  });
};

export const modBring = async (playerName: string) =>
  httpClient<Response>('/mod/bring', {
    method: 'POST',
    body: { playerName },
  });

export const modGoto = async (playerName: string) =>
  httpClient<Response>('/mod/goto', {
    method: 'POST',
    body: { playerName },
  });

export const modSetAccess = async (playerName: string, accessLevel: Access) =>
  httpClient<Response>('/mod/setAccess', {
    method: 'POST',
    body: { playerName, accessLevel },
  });

export const modSetSprite = async (playerName: string, spriteId: number) =>
  httpClient<Response>('/mod/setSprite', {
    method: 'POST',
    body: { playerName, spriteId },
  });

export const modSetMyAccess = async (accessLevel: Access) =>
  httpClient<Response>('/mod/setMyAccess', {
    method: 'POST',
    body: { accessLevel },
  });
