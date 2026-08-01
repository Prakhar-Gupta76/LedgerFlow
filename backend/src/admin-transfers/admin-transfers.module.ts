import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { AdminTransfersController } from "./admin-transfers.controller";
import { AdminTransfersService } from "./admin-transfers.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [AdminTransfersController],
  providers: [AdminTransfersService],
})
export class AdminTransfersModule {}
