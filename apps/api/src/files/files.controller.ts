import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { UPLOAD_PURPOSES } from '../db/schema';
import { AuthGuard, CurrentAuth } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
import { ZodBody } from '../common/zod-body';
import { forbidden, notFound } from '../common/errors';
import { MemoryStorageAdapter, STORAGE, type StorageAdapter } from '../adapters/storage';
import { UploadsService } from './uploads.service';

const UploadBody = z.object({
  errandId: z.string().uuid(),
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.string().max(60),
});

@Controller('uploads')
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Returns a key and a signed link; the app PUTs the photo to the link, then sends the key with its action. */
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodBody(UploadBody)) body: z.infer<typeof UploadBody>) {
    return this.uploads.create(auth, body);
  }
}

const SignedQuery = z.object({ m: z.enum(['GET', 'PUT']), exp: z.coerce.number(), sig: z.string().max(128) });

/**
 * Development storage only: serves the signed links the memory store hands out, as S3 would.
 * With S3 configured these routes refuse everything.
 */
@Controller('dev-files')
export class DevFilesController {
  constructor(@Inject(STORAGE) private readonly storage: StorageAdapter) {}

  private memory(method: 'GET' | 'PUT', key: string, q: z.infer<typeof SignedQuery>) {
    if (!(this.storage instanceof MemoryStorageAdapter)) throw notFound('not_found', 'Not found');
    if (q.m !== method || !this.storage.verify(method, key, q.exp, q.sig))
      throw forbidden('bad_signature', 'Link expired or invalid');
    return this.storage;
  }

  @Put(':key')
  upload(
    @Param('key') key: string,
    @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const store = this.memory('PUT', key, q);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    store.files.set(key, { bytes, contentType: req.headers['content-type'] ?? 'application/octet-stream' });
    res.status(200).end();
  }

  @Get(':key')
  download(
    @Param('key') key: string,
    @Query(new ZodBody(SignedQuery)) q: z.infer<typeof SignedQuery>,
    @Res() res: Response,
  ) {
    const file = this.memory('GET', key, q).files.get(key);
    if (!file) throw notFound('not_found', 'Not found');
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, max-age=600');
    res.send(file.bytes);
  }
}
