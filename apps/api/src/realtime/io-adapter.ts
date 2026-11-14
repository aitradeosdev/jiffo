import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/** Socket.IO with the same allowed origins as the HTTP API (CORS_ORIGINS), never any origin by default. */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origins: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const origin = this.origins === '*' ? true : this.origins.split(',').map((o) => o.trim());
    return super.createIOServer(port, { ...options, cors: { origin } } as ServerOptions);
  }
}
