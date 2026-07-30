import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsWorkerService } from "./analytics-worker.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsWorkerService],
})
export class AnalyticsModule {}
