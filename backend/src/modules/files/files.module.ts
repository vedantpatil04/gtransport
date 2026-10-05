import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { CloudinaryFileStorage } from './cloudinary.storage';
import { FileStorage } from './file-storage';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalDiskFileStorage } from './local-disk.storage';

/**
 * Binds the configured storage provider to the FileStorage abstraction.
 * Currently Cloudinary is the active image/file storage provider, with LocalDisk
 * fallback for development/tests and ready for Cloudflare R2 in the future.
 */
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: FileStorage,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FileStorage => {
        const { provider, localRoot, cloudinary } = config.fileStorage;
        if (provider === 'cloudinary') {
          const storage = new CloudinaryFileStorage(cloudinary);
          storage.logConfig();
          return storage;
        }
        if (config.isProduction) {
          new Logger('FilesModule').warn(
            `File storage provider "${provider}" is local disk. Configure Cloudinary or object storage (R2) before relying on this in production.`,
          );
        }
        const storage = new LocalDiskFileStorage(localRoot);
        storage.logRoot();
        return storage;
      },
    },
    FilesService,
  ],
  exports: [FileStorage, FilesService],
})
export class FilesModule {}
