import { DocumentType } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination/pagination';

export class ListDocumentsQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsUUID('7')
  vehicleId?: string;

  @IsOptional()
  @IsUUID('7')
  employeeId?: string;
}
