import { config } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * The seam where mail leaves the server, and nothing else. There is no
 * provider here: the reset flow, address verification and a receipt all
 * want "send this text to this person", and none should learn what SMTP
 * is. Adding one is a transport and a config value; callers stay as written.
 *
 * The default transport writes the message to the server log, so a
 * self-hosted game with no mail account can still reset a password by hand.
 * That cannot reach a player alone, which `mailReachesPlayers` says so no
 * screen offers a link that arrives nowhere.
 */

export interface Mail {
  /** Whatever identifies the recipient to the transport in use. */
  to: string;
  subject: string;
  text: string;
}

/**
 * Whether mail sent from here lands anywhere a player can read.
 *
 * False for every transport that ships today, and the answer the login screen
 * needs before it offers "forgot password" to somebody who would then wait for
 * a message that was written to a log file on a machine they do not own.
 */
export function mailReachesPlayers(): boolean {
  return false;
}

// Promise-returning without being async: every real transport will await a
// socket, and callers should already be written for that.
export function sendMail(mail: Mail): Promise<boolean> {
  if (config.mail.transport === 'none') return Promise.resolve(false);

  logger.info('[mail] no transport configured; message written here instead', {
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  return Promise.resolve(true);
}
