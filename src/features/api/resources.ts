import type { Page } from '@/lib/api/client';
import { authedRequest } from './session';
import type { ApiAssignment, ApiDocumentSummary, ApiDriver, ApiEmployee, ApiVehicle } from './types';

/** Typed wrappers around the Phase 1 endpoints. One place that knows the URLs. */

export interface EmployeeFilters {
  q?: string;
  role?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export const employeesApi = {
  list: (filters: EmployeeFilters = {}) => authedRequest<Page<ApiEmployee>>('/employees', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiEmployee>(`/employees/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiEmployee>('/employees', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiEmployee>(`/employees/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiEmployee>(`/employees/${id}/status`, { method: 'PATCH', body: { status, reason } }),
};

export interface DriverFilters {
  q?: string;
  status?: string;
  assigned?: number;
  limit?: number;
  cursor?: string;
}

export const driversApi = {
  list: (filters: DriverFilters = {}) => authedRequest<Page<ApiDriver>>('/drivers', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiDriver>(`/drivers/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiDriver>('/drivers', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiDriver>(`/drivers/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiDriver>(`/drivers/${id}/status`, { method: 'PATCH', body: { status, reason } }),
  documentSummary: (id: string) => authedRequest<ApiDocumentSummary>(`/drivers/${id}/documents/summary`),
  assignments: (id: string) => authedRequest<Page<ApiAssignment>>(`/drivers/${id}/assignments`),
};

export interface VehicleFilters {
  q?: string;
  status?: string;
  kind?: string;
  fuelType?: string;
  ownership?: string;
  financeStatus?: string;
  driverId?: string;
  assigned?: number;
  limit?: number;
  cursor?: string;
}

export const vehiclesApi = {
  list: (filters: VehicleFilters = {}) => authedRequest<Page<ApiVehicle>>('/vehicles', { query: { ...filters } }),
  get: (id: string) => authedRequest<ApiVehicle>(`/vehicles/${id}`),
  create: (body: Record<string, unknown>) => authedRequest<ApiVehicle>('/vehicles', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) => authedRequest<ApiVehicle>(`/vehicles/${id}`, { method: 'PATCH', body }),
  setStatus: (id: string, status: string, reason?: string) =>
    authedRequest<ApiVehicle>(`/vehicles/${id}/status`, { method: 'PATCH', body: { status, reason } }),
  saveFinancing: (id: string, body: Record<string, unknown>) =>
    authedRequest<ApiVehicle>(`/vehicles/${id}/financing`, { method: 'PUT', body }),
  assignments: (id: string) => authedRequest<Page<ApiAssignment>>(`/vehicles/${id}/assignments`),
  assignDriver: (id: string, driverId: string, notes?: string) =>
    authedRequest<ApiAssignment>(`/vehicles/${id}/assignment`, { method: 'POST', body: { driverId, notes } }),
  unassignDriver: (id: string, reason?: string) =>
    authedRequest<ApiAssignment>(`/vehicles/${id}/assignment`, { method: 'DELETE', body: { reason } }),
};
