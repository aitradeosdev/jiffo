import { Global, Module } from '@nestjs/common';
import { DevFilesController, UploadsController } from './files.controller';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  controllers: [UploadsController, DevFilesController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class FilesModule {}
