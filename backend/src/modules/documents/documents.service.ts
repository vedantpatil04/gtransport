import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { keysetArgs, toPage, type Page } from '../../common/pagination/pagination';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { requireDriverScope } from '../auth/access-scope';
import type { ListDocumentsQuery } from './dto/list-documents.dto';

const DOCUMENT_VIEW = {
  id: true,
  type: true,
  customName: true,
  ownerType: true,
  vehicleId: true,
  employeeId: true,
  documentNumber: true,
  issuer: true,
  issueDate: true,
  expiryDate: true,
  fileId: true,
  verificationStatus: true,
  verifiedAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, query: ListDocumentsQuery): Promise<Page<{ id: string }>> {
    const where: Prisma.DocumentWhereInput = {
      companyId: user.companyId,
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(user.role === UserRole.DRIVER ? await this.driverVisibility(user) : {}),
    };

    const rows = await this.prisma.document.findMany({ where, select: DOCUMENT_VIEW, ...keysetArgs(query) });
    return toPage(rows, query.limit);
  }

  /**
   * A driver sees their own documents and those of the vehicle currently assigned to them.
   * This clause is ANDed with any client filter, so a filter can only ever narrow the result.
   */
  private async driverVisibility(user: AuthenticatedUser): Promise<Prisma.DocumentWhereInput> {
    const { driverId, employeeId } = requireDriverScope(user);
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { currentAssignment: { driverId }, companyId: user.companyId, deletedAt: null },
      select: { id: true },
    });

    const visible: Prisma.DocumentWhereInput[] = [{ employeeId }];
    if (vehicle) visible.push({ vehicleId: vehicle.id });
    return { OR: visible };
  }
}
