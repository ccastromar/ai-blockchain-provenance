import { Injectable } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

// Gates operating Ernest (access tokens, emitter keys, anchoring, legal holds): the caller needs
// the platform.admin governance function (contract v1). Writing evidence is not enough.
@Injectable()
export class PlatformAdminGuard extends ApiKeyGuard {
  protected readonly requiredFunction: string = 'platform.admin';
  protected readonly refusal: string = 'Operating Ernest needs the platform.admin governance function';
}
