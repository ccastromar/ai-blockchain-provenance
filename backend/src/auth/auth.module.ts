import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AccessToken, AccessTokenSchema } from './access-token.schema';
import { AccessTokenService } from './access-token.service';

// Global because ApiKeyGuard and ReadAccessGuard need AccessTokenService, and those
// guards are attached from other feature modules (e.g. IngestionModule) via
// @UseGuards(ApiKeyGuard) as well as globally via APP_GUARD in AppModule.
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: AccessToken.name, schema: AccessTokenSchema }])],
  controllers: [AuthController],
  providers: [AccessTokenService],
  exports: [AccessTokenService],
})
export class AuthModule {}
