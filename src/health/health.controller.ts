import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from '../database/database.service.js';

@Controller()
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Liveness: the process is up and serving HTTP. Never touches dependencies. */
  @Get('health')
  health(): { status: 'ok'; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: required dependencies (PostgreSQL) are reachable. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<{
    status: 'ready' | 'unavailable';
    checks: { database: 'up' | 'down' };
  }> {
    try {
      await this.db.ping();
      return { status: 'ready', checks: { database: 'up' } };
    } catch {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'unavailable', checks: { database: 'down' } };
    }
  }
}
