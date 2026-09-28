import {
  BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { OFFICE_ROLES } from '../auth/roles';
import { FilesService, RECEIPT_MAX_BYTES } from './files.service';

/**
 * Receipt upload and download. Bytes go to the configured FileStorage; PostgreSQL only ever
 * holds the metadata row.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('receipts')
  @Roles(UserRole.DRIVER, ...OFFICE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 } }))
  async uploadReceipt(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the receipt as a file named "file".');
    const result = await this.files.storeReceipt({
      companyId: user.companyId,
      uploadedById: user.id,
      category: 'receipts',
      filename: file.originalname || 'receipt',
      mimeType: file.mimetype,
      bytes: new Uint8Array(file.buffer),
    });
    return { fileId: result.id, deduplicated: result.deduplicated };
  }

  /**
   * Official documents (RC, insurance, licence …). Same checks as receipts, and the original is
   * stored exactly as uploaded — no resizing or recompression.
   */
  @Post('documents')
  @Roles(UserRole.DRIVER, ...OFFICE_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 } }))
  async uploadDocument(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach the document as a file named "file".');
    const result = await this.files.storeReceipt({
      companyId: user.companyId,
      uploadedById: user.id,
      category: 'documents',
      filename: file.originalname || 'document',
      mimeType: file.mimetype,
      bytes: new Uint8Array(file.buffer),
    });
    return { fileId: result.id, deduplicated: result.deduplicated };
  }

  @Get(':id/content')
  @Roles(UserRole.DRIVER, ...OFFICE_ROLES)
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.files.readFor(user, id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    // Receipts are private: never let a shared proxy keep a copy.
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(file.bytes));
  }
}
