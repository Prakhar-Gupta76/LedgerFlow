import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
