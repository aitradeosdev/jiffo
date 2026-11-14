import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, contactsOf, type AppConfig } from '../config/app-config';
import { notFound } from '../common/errors';
import { PAGE_CSP } from '../common/security-headers';

const DAY_MS = 86_400_000;
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** How a contact reads on the page: an email address without its mailto:, a link as it is. */
const shown = (contact: string) => (contact.startsWith('mailto:') ? contact.slice('mailto:'.length) : contact);

/**
 * How to tell Jiffo about a security problem (docs/security-plan.md, S11): security.txt (RFC 9116) for tools
 * and researchers, and a page with the rules, both from SECURITY_CONTACT.
 */
@Controller()
export class SecurityContactController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private contacts() {
    const contacts = contactsOf(this.config.SECURITY_CONTACT);
    if (!contacts.length) throw notFound('not_found', 'Not found');
    return contacts;
  }

  private base() {
    return this.config.PUBLIC_API_URL.replace(/\/+$/, '');
  }

  @Get('.well-known/security.txt')
  securityTxt(@Res() res: Response) {
    const contacts = this.contacts();
    // Dated a little under six months ahead, from the start of today, so the file never reads as stale.
    const expires = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS + 180 * DAY_MS);
    const lines = [
      ...contacts.map((c) => `Contact: ${c}`),
      `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
      'Preferred-Languages: en',
      `Canonical: ${this.base()}/.well-known/security.txt`,
      `Policy: ${this.base()}/security`,
    ];
    res
      .type('text/plain; charset=utf-8')
      .set('cache-control', 'public, max-age=86400')
      .send(`${lines.join('\n')}\n`);
  }

  @Get('security')
  page(@Res() res: Response) {
    const links = this.contacts()
      .map((c) => `<a href="${escape(c)}">${escape(shown(c))}</a>`)
      .join(' or ');
    res
      .type('html')
      .set('content-security-policy', PAGE_CSP)
      .set('cache-control', 'public, max-age=3600')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report a security problem · Jiffo</title></head><body style="font-family:system-ui,sans-serif;padding:24px;max-width:680px;line-height:1.5">` +
          `<h1 style="font-size:24px">Report a security problem</h1>` +
          `<p>If you find a weakness in Jiffo's apps, admin panel or API, tell us privately at ${links}. Say what you found, how to make it happen again, and what someone could do with it.</p>` +
          `<h2 style="font-size:18px">Please</h2><ul>` +
          `<li>Test only with your own accounts and your own money.</li>` +
          `<li>Don't look at, change or delete anyone else's details, messages or money. If you reach them by accident, stop and tell us.</li>` +
          `<li>Don't slow down or break the service, send spam, or trick our staff, customers or agents.</li>` +
          `<li>Give us time to fix the problem before you tell anyone else.</li></ul>` +
          `<h2 style="font-size:18px">What we do</h2>` +
          `<p>We confirm we've got your report, keep you told while we fix it, and let you know when it's fixed. If you follow these rules in good faith, we won't take action against you for your research.</p>` +
          `</body></html>`,
      );
  }
}
