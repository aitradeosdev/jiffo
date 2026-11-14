import { Injectable, Logger } from '@nestjs/common';
import { adminRoleLabel } from '@jiffo/shared';
import type { EmailAdapter } from '../adapters/email';
import { unavailable } from '../common/errors';
import { NotConfiguredEmail } from '../providers/not-configured';
import { ProvidersService } from '../providers/providers.service';

interface Link {
  /** The teammate's own address, as stored: the link goes nowhere else. */
  to: string;
  name: string;
  /** Who made the link, so the teammate knows who to ask if they didn't expect it. */
  by: string;
  url: string;
  hours: number;
}

/**
 * Invite and reset links, emailed only to the teammate (docs/security-plan.md, D3, finding 10). Whoever makes
 * a link never sees it, so they can't use it to sign in as the teammate.
 */
@Injectable()
export class StaffMail {
  private readonly logger = new Logger(StaffMail.name);
  constructor(private readonly providers: ProvidersService) {}

  /**
   * The email provider in use, checked before anything is saved. A provider switched on in the panel is used
   * or nothing is: its settings failing to load never falls back to the environment's stand-in.
   */
  ready(): EmailAdapter {
    const active = this.providers.activeProvider('email');
    const adapter = active ? this.providers.fromSettings('email', active) : this.providers.current('email');
    if (!adapter) {
      throw unavailable(
        'email_failed',
        "The email provider that's switched on can't be used. Check its settings under Settings, Providers.",
      );
    }
    if (adapter instanceof NotConfiguredEmail) {
      throw unavailable(
        'email_not_configured',
        "Email isn't set up yet. Add an email provider under Settings, Providers, then try again.",
      );
    }
    return adapter;
  }

  invite(email: EmailAdapter, link: Link & { role: string }) {
    return this.send(email, link.to, 'Your invite to Jiffo Admin', [
      `Hi ${link.name},`,
      '',
      `${link.by} added you to the Jiffo admin team as ${adminRoleLabel(link.role)}.`,
      `Choose your password here. The link works once, for ${link.hours} hours:`,
      link.url,
      '',
      "You'll set up an authenticator app (such as Google Authenticator) when you first sign in.",
      "If you didn't expect this, ignore this email and tell Jiffo's owner.",
    ]);
  }

  reset(email: EmailAdapter, link: Link) {
    return this.send(email, link.to, 'Your Jiffo Admin access was reset', [
      `Hi ${link.name},`,
      '',
      `${link.by} reset your Jiffo Admin access. Your password and authenticator no longer work, and you were signed out everywhere.`,
      `Set them up again here. The link works once, for ${link.hours} hours:`,
      link.url,
      '',
      "If you didn't ask for this, tell Jiffo's owner straight away.",
    ]);
  }

  /** True when the provider took the email. A failure is logged, without the link, and reported as false. */
  private async send(email: EmailAdapter, to: string, subject: string, lines: string[]) {
    try {
      await email.send({ to, subject, text: lines.join('\n') });
      return true;
    } catch (error) {
      this.logger.warn(`Staff email (${subject}) failed: ${(error as Error).message}`);
      return false;
    }
  }
}
