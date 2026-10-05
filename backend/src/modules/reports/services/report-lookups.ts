import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Names for grouped results. A breakdown groups by id; these turn a page of ids into labels in
 * one query per kind — never one query per row.
 */
@Injectable()
export class ReportLookups {
  constructor(private readonly prisma: PrismaService) {}

  async vehicles(companyId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.vehicle.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, registrationNumber: true } });
    return new Map(rows.map((row) => [row.id, row.registrationNumber]));
  }

  async drivers(companyId: string, ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.driver.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, employee: { select: { fullName: true } } } });
    return new Map(rows.map((row) => [row.id, row.employee.fullName]));
  }

  async employees(companyId: string, ids: (string | null)[]): Promise<Map<string, { name: string; code: string }>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, fullName: true, employeeCode: true } });
    return new Map(rows.map((row) => [row.id, { name: row.fullName, code: row.employeeCode }]));
  }

  async companyName(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    return company?.name ?? 'Gangamata Transport';
  }

  /** Human label for a filter id, for the "applied filters" block of an export. */
  async filterLabels(companyId: string, filters: { vehicleId?: string; driverId?: string; employeeId?: string }): Promise<{ label: string; value: string }[]> {
    const out: { label: string; value: string }[] = [];
    if (filters.vehicleId) out.push({ label: 'Vehicle', value: (await this.vehicles(companyId, [filters.vehicleId])).get(filters.vehicleId) ?? filters.vehicleId });
    if (filters.driverId) out.push({ label: 'Driver', value: (await this.drivers(companyId, [filters.driverId])).get(filters.driverId) ?? filters.driverId });
    if (filters.employeeId) out.push({ label: 'Employee', value: (await this.employees(companyId, [filters.employeeId])).get(filters.employeeId)?.name ?? filters.employeeId });
    return out;
  }
}
