import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { AdminWalletsController } from "./admin-wallets.controller";
import { AdminWalletsService } from "./admin-wallets.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [AdminWalletsController],
  providers: [AdminWalletsService],
})
export class AdminWalletsModule {}
