import { Injectable, NestMiddleware } from '@nestjs/common';
import { hasRole } from './ernest-role';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// A process without the `writer` role is a read replica: it refuses every state-changing
// request before any guard or handler runs, so no write path is reachable on it by accident.
@Injectable()
export class ReadReplicaMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    if (SAFE_METHODS.has(req.method) || hasRole('writer')) return next();
    res.setHeader('Allow', 'GET, HEAD, OPTIONS');
    res.status(405).json({
      statusCode: 405,
      error: 'Method Not Allowed',
      message: 'This Ernest instance is a read replica (ERNEST_ROLE); send writes to a writer instance',
    });
  }
}
