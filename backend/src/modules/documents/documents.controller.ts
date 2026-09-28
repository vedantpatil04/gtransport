import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { todayInIndia } from '../../common/dates/financial-year';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { FLEET_MANAGE_ROLES, OFFICE_ROLES } from '../auth/roles';
import {
  ArchiveDocumentDto, CreateDocumentDto, CreateMyDocumentDto, DocumentDetailsDto, ListDocumentsQuery, RejectDocumentDto,
} from './dto/list-documents.dto';
import { presentCompliance, presentDocument } from './document.presenter';
import { DocumentsService } from './documents.service';

const uuid = () => new ParseUUIDPipe({ version: '7' });

/**
 * The single document module for vehicles and people. Drivers are scoped by the service to
 * their own documents and their assigned vehicle's; the office sees the company.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // ── Shared (driver-scoped automatically) ──

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDocumentsQuery) {
    const page = await this.documents.list(user, query);
    const today = todayInIndia();
    return { ...page, data: page.data.map((d) => presentDocument(d, today)) };
  }

  // ── Driver ──

  /** Assigned-vehicle documents and the driver's own licence, with NOT_UPLOADED gaps. */
  @Get('mine')
  @Roles(UserRole.DRIVER)
  async mine(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.documents.mine(user);
    const today = todayInIndia();
    return {
      vehicle: result.vehicle ? { ...result.vehicle, documents: presentCompliance(result.vehicle.documents, today) } : null,
      personal: presentCompliance(result.personal, today),
    };
  }

  @Post('mine')
  @Roles(UserRole.DRIVER)
  async uploadMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMyDocumentDto, @Res({ passthrough: true }) res: Response) {
    const { document, created } = await this.documents.createForDriver(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentDocument(document, todayInIndia());
  }

  // ── Office ──

  @Get('summary')
  @Roles(...OFFICE_ROLES)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.documents.summary(user.companyId);
  }

  @Get('vehicle/:vehicleId')
  @Roles(...OFFICE_ROLES)
  async vehicle(@CurrentUser() user: AuthenticatedUser, @Param('vehicleId', uuid()) vehicleId: string) {
    return presentCompliance(await this.documents.vehicleCompliance(user.companyId, vehicleId), todayInIndia());
  }

  @Get('person/:employeeId')
  @Roles(...OFFICE_ROLES)
  async person(@CurrentUser() user: AuthenticatedUser, @Param('employeeId', uuid()) employeeId: string) {
    return presentCompliance(await this.documents.personCompliance(user.companyId, employeeId), todayInIndia());
  }

  @Post()
  @Roles(...FLEET_MANAGE_ROLES)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDocumentDto, @Res({ passthrough: true }) res: Response) {
    const { document, created } = await this.documents.createForOffice(user, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentDocument(document, todayInIndia());
  }

  @Get(':id')
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    const document = await this.documents.findById(user, id);
    return { ...presentDocument(document, todayInIndia()), uploadedBy: await this.documents.uploaderName(user.companyId, document.createdById) };
  }

  @Get(':id/history')
  async history(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    const today = todayInIndia();
    return (await this.documents.history(user, id)).map((d) => presentDocument(d, today));
  }

  /** Drivers may replace documents they can see; office replacements are verified on upload. */
  @Post(':id/replace')
  @Roles(UserRole.DRIVER, ...FLEET_MANAGE_ROLES)
  async replace(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: DocumentDetailsDto) {
    return presentDocument((await this.documents.replace(user, id, dto)).document, todayInIndia());
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  async verify(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return presentDocument(await this.documents.verify(user, id), todayInIndia());
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: RejectDocumentDto) {
    return presentDocument(await this.documents.reject(user, id, dto.reason), todayInIndia());
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(...FLEET_MANAGE_ROLES)
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: ArchiveDocumentDto) {
    return presentDocument(await this.documents.archive(user, id, dto.reason), todayInIndia());
  }
}
