import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';

// 400/404/409/413 bodies are asserted by the integration tests; a 500 can't
// be triggered there.
describe('HttpExceptionFilter', () => {
  it('hides internals of unexpected errors', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', originalUrl: '/api/v1/payments' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new HttpExceptionFilter().catch(new Error('relation "secret_table" does not exist'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0]?.[0] as { message: string; code: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('secret_table');
  });
});
