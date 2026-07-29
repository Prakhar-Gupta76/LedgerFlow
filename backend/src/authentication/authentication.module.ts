import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DatabaseModule } from "../database/database.module";
import { AuthenticationController } from "./authentication.controller";
import { AuthenticationService } from "./authentication.service";
import { AccessTokenGuard } from "./access-token.guard";

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthenticationController],
  providers: [AuthenticationService, AccessTokenGuard],
  exports: [JwtModule, AccessTokenGuard],
})
export class AuthenticationModule {}
