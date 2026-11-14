import { CanActivate, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { notFound } from './errors';

/**
 * For routes that exist only to stand in for a provider while developing (docs/security-plan.md, S8). In
 * production they answer as if they weren't there, whatever else is set up.
 */
@Injectable()
export class DevelopmentOnlyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (this.config.NODE_ENV === 'production') throw notFound('not_found', 'Not found');
    return true;
  }
}
