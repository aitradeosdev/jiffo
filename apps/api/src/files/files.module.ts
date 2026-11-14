import { Global, Module } from '@nestjs/common';
import { DevFilesController, UploadsController } from './files.controller';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  // The development store's file routes don't exist in production (docs/security-plan.md, S8).
  controllers: process.env.NODE_ENV === 'production' ? [UploadsController] : [UploadsController, DevFilesController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class FilesModule {}
