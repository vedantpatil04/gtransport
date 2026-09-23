import { Logger, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { FileStorage } from './file-storage';
import { FilesService } from './files.service';
import { LocalDiskFileStorage } from './local-disk.storage';

/**
 * Binds the configured storage provider to the FileStorage abstraction.
 * Adding Cloudflare R2 later means adding an adapter here and widening
 * FILE_STORAGE_PROVIDER — no business module changes.
 */
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): FileStorage => {
        const { provider, localRoot } = config.fileStorage;
        if (config.isProduction) {
          new Logger('FilesModule').warn(
            `File storage provider "${provider}" is local disk. Configure object storage (R2) before relying on this in production.`,
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
