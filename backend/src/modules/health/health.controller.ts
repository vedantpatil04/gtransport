import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../auth/decorators';

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  timestamp: string;
  checks: { database: 'up' | 'down' };
}

/**
 * Deployment health probe. Public and outside the API version prefix so load balancers and
 * process supervisors can call it without credentials. Returns 503 when the database is
 * unreachable, so an unhealthy instance is taken out of rotation instead of serving errors.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.ping();
    } catch {
      database = 'down';
    }

    response.status(database === 'up' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
  }
}
