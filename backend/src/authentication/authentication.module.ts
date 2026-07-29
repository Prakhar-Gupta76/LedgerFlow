import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DatabaseModule } from "../database/database.module";
import { AuthenticationController } from "./authentication.controller";
import { AuthenticationService } from "./authentication.service";

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthenticationController],
  providers: [AuthenticationService],
})
export class AuthenticationModule {}
