import { Injectable, Logger } from '@nestjs/common';
import { adminRoleLabel } from '@jiffo/shared';
import { unavailable } from '../common/errors';
import { ProviderNotConfigured } from '../providers/not-configured';
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

  invite(link: Link & { role: string }) {
    return this.send(link.to, 'Your invite to Jiffo Admin', [
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

  reset(link: Link) {
    return this.send(link.to, 'Your Jiffo Admin access was reset', [
      `Hi ${link.name},`,
      '',
      `${link.by} reset your Jiffo Admin access. Your password and authenticator no longer work, and you were signed out everywhere.`,
      `Set them up again here. The link works once, for ${link.hours} hours:`,
      link.url,
      '',
      "If you didn't ask for this, tell Jiffo's owner straight away.",
    ]);
  }

  private async send(to: string, subject: string, lines: string[]) {
    try {
      await this.providers.current('email').send({ to, subject, text: lines.join('\n') });
    } catch (error) {
      if (error instanceof ProviderNotConfigured) {
        throw unavailable(
          'email_not_configured',
          "Email isn't set up yet. Add an email provider under Settings, Providers, then try again.",
        );
      }
      this.logger.warn(`Staff email failed: ${(error as Error).message}`);
      throw unavailable(
        'email_failed',
        "The email couldn't be sent. Try again, or test the email provider under Settings, Providers.",
      );
    }
  }
}
