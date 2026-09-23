import { Controller, Get, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators';
import { DocumentsService } from './documents.service';
import { ListDocumentsQuery } from './dto/list-documents.dto';

/** Readable by any authenticated user; drivers are scoped to their own records in the service. */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQuery) {
    return this.documents.list(user, query);
  }
}
