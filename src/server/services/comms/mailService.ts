import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

/**
 * The seam where mail leaves the server. One provider, SMTP, which every
 * mail account speaks: a relay, a mailbox host or an API provider's SMTP
 * endpoint all take the same URL, and every caller only wants "send this
 * text to this person".
 *
 * With no relay the default transport writes the message to the server log,
 * so a self-hosted game with no mail account can still reset a password by
 * hand. That cannot reach a player alone, which `mailReachesPlayers` says
 * so no screen offers a link that arrives nowhere.
 */

export interface Mail {
  /** Whatever identifies the recipient to the transport in use. */
  to: string;
  subject: string;
  text: string;
}

/**
 * Whether mail sent from here lands anywhere a player can read, which the
 * login screen asks before offering "forgot password".
 */
export function mailReachesPlayers(): boolean {
  return config.mail.transport === 'smtp';
}

// Built on first use and kept: nodemailer pools the connection, and building
// one per message would pay a TLS handshake for every reset link.
let transporter: Transporter | null = null;

export async function sendMail(mail: Mail): Promise<boolean> {
  if (config.mail.transport === 'none') return false;

  if (config.mail.transport !== 'smtp') {
    logger.info(
      '[mail] no transport configured; message written here instead',
      {
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      },
    );
    return true;
  }

  try {
    transporter ??= nodemailer.createTransport(config.mail.smtpUrl);
    await transporter.sendMail({ from: config.mail.from, ...mail });
    return true;
  } catch (err) {
    // Never thrown on: a relay that is down is a fact about the deployment, and
    // the caller's job (minting a token, saving an address) already happened.
    // The boolean says whether to tell the player their mail is on its way.
    logger.error('[mail] send failed', { to: mail.to, err });
    return false;
  }
}
