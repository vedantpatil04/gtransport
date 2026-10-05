import { Injectable } from '@nestjs/common';
import { DocumentState, DocumentType, DocumentVerificationStatus, Prisma, VehicleStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { toIsoDate } from '../../../common/dates/financial-year';
import { REQUIRED_DRIVER_DOCUMENTS, REQUIRED_VEHICLE_DOCUMENTS } from '../../documents/documents.service';
import type { ComplianceExportQuery, ComplianceRecordsQuery, ComplianceReportQuery } from '../dto/report-query.dto';
import { LABELS, REPORT_TITLES, label, type ReportDocument } from '../report-document';
import { detailTake, resolveSort, searchText, toReportPage, type DetailLimits, type ReportContext } from '../report-context';
import { DEFAULT_EXPIRY_WINDOW, documentHealth, expiryBand, sortRows, type DocumentHealth } from '../report-maths';
import { ReportLookups } from './report-lookups';

const SORTS = ['expiry', 'type', 'owner', 'status'] as const;
type ComplianceSort = (typeof SORTS)[number];

export interface ComplianceItem {
  /** Null for a missing document: there is no record, and none is invented. */
  documentId: string | null;
  type: DocumentType;
  owner: { kind: 'VEHICLE' | 'EMPLOYEE' | 'COMPANY'; id: string | null; label: string; driverId: string | null };
  documentNumber: string | null;
  issuer: string | null;
  expiryDate: string | null;
  daysRemaining: number | null;
  health: DocumentHealth;
  band: ReturnType<typeof expiryBand> | 'missing';
  verification: DocumentVerificationStatus | null;
  fileId: string | null;
}

const HEALTH_ORDER: Record<DocumentHealth, number> = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, VALID: 3 };

/**
 * Document health as of today. Source of truth: current documents (superseded versions and
 * archived ones are history, not cover) of active vehicles, drivers and the company.
 *
 * A required document that was never uploaded is reported as MISSING, computed from the vehicles
 * and drivers that should hold it — it is never stored, and never counted as expired.
 * "Expiring soon" uses the window the viewer chooses (7, 30, 60 or 90 days).
 */
@Injectable()
export class ComplianceReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: ReportLookups,
  ) {}

  private async items(ctx: ReportContext, query: ComplianceReportQuery): Promise<ComplianceItem[]> {
    const windowDays = query.window ?? DEFAULT_EXPIRY_WINDOW;
    let employeeOfDriver: string | null = null;
    if (query.driverId) {
      const driver = await this.prisma.driver.findFirst({ where: { id: query.driverId, companyId: ctx.companyId }, select: { employeeId: true } });
      employeeOfDriver = driver?.employeeId ?? '00000000-0000-7000-8000-000000000000'; // unknown driver: matches nothing
    }
    const wantVehicles = query.owner !== 'EMPLOYEE' && !query.driverId;
    const wantPeople = query.owner !== 'VEHICLE' && !query.vehicleId;
    const typeFilter = query.documentType ? { type: query.documentType } : {};

    const [vehicles, drivers, documents] = await Promise.all([
      wantVehicles
        ? this.prisma.vehicle.findMany({
            where: { companyId: ctx.companyId, deletedAt: null, status: { not: VehicleStatus.RETIRED }, ...(query.vehicleId ? { id: query.vehicleId } : {}) },
            select: { id: true, registrationNumber: true },
          })
        : [],
      wantPeople
        ? this.prisma.driver.findMany({
            where: { companyId: ctx.companyId, deletedAt: null, ...(employeeOfDriver ? { employeeId: employeeOfDriver } : {}) },
            select: { id: true, employee: { select: { id: true, fullName: true } } },
          })
        : [],
      this.prisma.document.findMany({
        where: {
          companyId: ctx.companyId,
          state: DocumentState.CURRENT,
          deletedAt: null,
          ...typeFilter,
          OR: [
            ...(wantVehicles ? [{ vehicleId: query.vehicleId ?? { not: null }, vehicle: { deletedAt: null, status: { not: VehicleStatus.RETIRED } } } satisfies Prisma.DocumentWhereInput] : []),
            ...(wantPeople ? [{ employeeId: employeeOfDriver ?? { not: null }, employee: { deletedAt: null } } satisfies Prisma.DocumentWhereInput] : []),
            ...(wantVehicles && wantPeople && !query.vehicleId && !query.driverId ? [{ vehicleId: null, employeeId: null }] : []),
          ],
        },
        select: {
          id: true, type: true, documentNumber: true, issuer: true, expiryDate: true, verificationStatus: true, fileId: true,
          vehicleId: true, employeeId: true,
          vehicle: { select: { registrationNumber: true } },
          employee: { select: { fullName: true, driver: { select: { id: true } } } },
        },
      }),
    ]);

    const items: ComplianceItem[] = documents.map((d) => {
      const { health, daysRemaining } = documentHealth(d.expiryDate, ctx.today, windowDays);
      const owner: ComplianceItem['owner'] = d.vehicleId
        ? { kind: 'VEHICLE', id: d.vehicleId, label: d.vehicle?.registrationNumber ?? '—', driverId: null }
        : d.employeeId
          ? { kind: 'EMPLOYEE', id: d.employeeId, label: d.employee?.fullName ?? '—', driverId: d.employee?.driver?.id ?? null }
          : { kind: 'COMPANY', id: null, label: 'Company', driverId: null };
      return {
        documentId: d.id,
        type: d.type,
        owner,
        documentNumber: d.documentNumber,
        issuer: d.issuer,
        expiryDate: d.expiryDate ? toIsoDate(d.expiryDate) : null,
        daysRemaining,
        health,
        band: expiryBand(d.expiryDate, ctx.today),
        verification: d.verificationStatus,
        fileId: d.fileId,
      };
    });

    // Missing required documents, derived from who should hold them.
    const missing = (type: DocumentType, owner: ComplianceItem['owner']): ComplianceItem => ({
      documentId: null, type, owner, documentNumber: null, issuer: null, expiryDate: null, daysRemaining: null,
      health: 'MISSING', band: 'missing', verification: null, fileId: null,
    });
    const vehicleTypes = REQUIRED_VEHICLE_DOCUMENTS.filter((t) => !query.documentType || t === query.documentType);
    for (const v of vehicles) {
      for (const type of vehicleTypes) {
        if (!documents.some((d) => d.vehicleId === v.id && d.type === type)) items.push(missing(type, { kind: 'VEHICLE', id: v.id, label: v.registrationNumber, driverId: null }));
      }
    }
    const personTypes = REQUIRED_DRIVER_DOCUMENTS.filter((t) => !query.documentType || t === query.documentType);
    for (const d of drivers) {
      for (const type of personTypes) {
        if (!documents.some((doc) => doc.employeeId === d.employee.id && doc.type === type)) items.push(missing(type, { kind: 'EMPLOYEE', id: d.employee.id, label: d.employee.fullName, driverId: d.id }));
      }
    }
    return items;
  }

  private matches(item: ComplianceItem, query: ComplianceReportQuery, q?: string): boolean {
    const search = searchText(q)?.toLowerCase();
    if (search && ![item.owner.label, item.documentNumber, item.issuer].some((v) => v?.toLowerCase().includes(search))) return false;
    if (!query.status) return true;
    if (query.status === 'PENDING_VERIFICATION') return item.verification === DocumentVerificationStatus.PENDING;
    return item.health === query.status;
  }

  private summarise(items: ComplianceItem[], windowDays: number) {
    const held = items.filter((i) => i.health !== 'MISSING');
    const count = (list: ComplianceItem[], predicate: (i: ComplianceItem) => boolean) => list.filter(predicate).length;
    const types = [...new Set(items.map((i) => i.type))].sort((a, b) => Object.values(DocumentType).indexOf(a) - Object.values(DocumentType).indexOf(b));
    return {
      windowDays,
      totals: {
        documents: held.length,
        valid: count(held, (i) => i.health === 'VALID'),
        expiring: count(held, (i) => i.health === 'EXPIRING'),
        expired: count(held, (i) => i.health === 'EXPIRED'),
        missing: count(items, (i) => i.health === 'MISSING'),
        pendingVerification: count(held, (i) => i.verification === DocumentVerificationStatus.PENDING),
      },
      bands: {
        expired: count(held, (i) => i.band === 'expired'),
        d7: count(held, (i) => i.band === 'd7'),
        d30: count(held, (i) => i.band === 'd30'),
        d60: count(held, (i) => i.band === 'd60'),
        d90: count(held, (i) => i.band === 'd90'),
      },
      byType: types.map((type) => {
        const of = items.filter((i) => i.type === type);
        return {
          type,
          documents: count(of, (i) => i.health !== 'MISSING'),
          valid: count(of, (i) => i.health === 'VALID'),
          expiring: count(of, (i) => i.health === 'EXPIRING'),
          expired: count(of, (i) => i.health === 'EXPIRED'),
          missing: count(of, (i) => i.health === 'MISSING'),
          pendingVerification: count(of, (i) => i.verification === DocumentVerificationStatus.PENDING),
        };
      }),
    };
  }

  async summary(ctx: ReportContext, query: ComplianceReportQuery, q?: string) {
    const items = (await this.items(ctx, query)).filter((i) => this.matches(i, { ...query, status: undefined }, q));
    return this.summarise(items, query.window ?? DEFAULT_EXPIRY_WINDOW);
  }

  private sorted(items: ComplianceItem[], field: ComplianceSort, dir: 'asc' | 'desc') {
    const value: Record<ComplianceSort, (i: ComplianceItem) => string | number | null> = {
      // Missing documents first when soonest-first: they are the most urgent gap.
      expiry: (i) => (i.health === 'MISSING' ? -100_000 : i.daysRemaining),
      type: (i) => i.type,
      owner: (i) => i.owner.label,
      status: (i) => HEALTH_ORDER[i.health],
    };
    return sortRows(items, value[field], dir, (i) => `${i.owner.label}|${i.type}`);
  }

  async records(ctx: ReportContext, query: ComplianceRecordsQuery) {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'expiry', dir: 'asc' });
    const items = this.sorted((await this.items(ctx, query)).filter((i) => this.matches(i, query, query.q)), sort.field, sort.dir);
    const start = (query.page - 1) * query.pageSize;
    return toReportPage(items.slice(start, start + query.pageSize), items.length, query, sort);
  }

  async document(ctx: ReportContext, query: ComplianceExportQuery, limits: DetailLimits): Promise<Partial<ReportDocument>> {
    const sort = resolveSort(query.sort, query.dir, SORTS, { field: 'expiry', dir: 'asc' });
    const all = await this.items(ctx, query);
    const s = this.summarise(all.filter((i) => this.matches(i, { ...query, status: undefined }, query.q)), query.window ?? DEFAULT_EXPIRY_WINDOW);
    const matching = this.sorted(all.filter((i) => this.matches(i, query, query.q)), sort.field, sort.dir);
    const rows = matching.slice(0, detailTake(matching.length, limits));

    return {
      title: REPORT_TITLES.compliance,
      period: null,
      filters: [
        ...(await this.lookups.filterLabels(ctx.companyId, query)),
        ...(query.documentType ? [{ label: 'Document type', value: label(LABELS.documentType, query.documentType) }] : []),
        ...(query.owner ? [{ label: 'Owner', value: label(LABELS.owner, query.owner) }] : []),
        ...(query.status ? [{ label: 'Status', value: query.status === 'PENDING_VERIFICATION' ? 'Pending verification' : label(LABELS.documentHealth, query.status) }] : []),
        { label: 'Expiring window', value: `${s.windowDays} days` },
        ...(query.q ? [{ label: 'Search', value: query.q }] : []),
      ],
      summary: [
        { label: 'Documents held', value: s.totals.documents, kind: 'count' },
        { label: 'Valid', value: s.totals.valid, kind: 'count' },
        { label: `Expiring within ${s.windowDays} days`, value: s.totals.expiring, kind: 'count' },
        { label: 'Expired', value: s.totals.expired, kind: 'count' },
        { label: 'Missing', value: s.totals.missing, kind: 'count' },
        { label: 'Pending verification', value: s.totals.pendingVerification, kind: 'count' },
      ],
      tables: [
        {
          title: 'Status by document type',
          columns: [
            { header: 'Document', kind: 'text', width: 1.5 }, { header: 'Held', kind: 'count' }, { header: 'Valid', kind: 'count' },
            { header: 'Expiring', kind: 'count' }, { header: 'Expired', kind: 'count' }, { header: 'Missing', kind: 'count' }, { header: 'Pending verification', kind: 'count' },
          ],
          rows: s.byType.map((t) => [label(LABELS.documentType, t.type), t.documents, t.valid, t.expiring, t.expired, t.missing, t.pendingVerification]),
        },
        {
          title: 'Expiry bands',
          columns: [{ header: 'Band', kind: 'text', width: 2 }, { header: 'Documents', kind: 'count' }],
          rows: [['Expired', s.bands.expired], ['Within 7 days', s.bands.d7], ['8–30 days', s.bands.d30], ['31–60 days', s.bands.d60], ['61–90 days', s.bands.d90]],
        },
        {
          title: 'Documents',
          detail: true,
          totalRecords: matching.length,
          columns: [
            { header: 'Document', kind: 'text' }, { header: 'Owner', kind: 'text' }, { header: 'Name / vehicle', kind: 'text', width: 1.5 },
            { header: 'Number', kind: 'text' }, { header: 'Issuer', kind: 'text', width: 1.5 }, { header: 'Expiry', kind: 'date' },
            { header: 'Days left', kind: 'number' }, { header: 'Status', kind: 'text' }, { header: 'Verification', kind: 'text' },
          ],
          rows: rows.map((i) => [
            label(LABELS.documentType, i.type), label(LABELS.owner, i.owner.kind), i.owner.label, i.documentNumber, i.issuer, i.expiryDate,
            i.daysRemaining, label(LABELS.documentHealth, i.health), i.verification ? label(LABELS.verification, i.verification) : '',
          ]),
        },
      ],
      definitions: [
        'Status is as of the date the report was generated. A document is valid through its expiry date and expired from the next day.',
        `Expiring = expiry within the chosen window (${s.windowDays} days). Documents with no expiry date (such as an RC) count as valid.`,
        'Missing = a required document (RC, insurance, PUC, tyre insurance, fitness, permit for each active vehicle; driving licence for each driver) with no current record. Missing documents are never counted as expired.',
        'Documents of retired vehicles are not included. Superseded and archived versions are history, not cover.',
      ],
    };
  }
}
