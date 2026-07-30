import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { RegistrationModule } from "./registration/registration.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { AuthenticationModule } from "./authentication/authentication.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { FundingModule } from "./funding/funding.module";
import { TransfersModule } from "./transfers/transfers.module";
import { TransactionHistoryModule } from "./transaction-history/transaction-history.module";
import { WalletStatementModule } from "./wallet-statement/wallet-statement.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 30,
      },
    ]),
    DatabaseModule,
    RegistrationModule,
    AuthenticationModule,
    DashboardModule,
    FundingModule,
    TransfersModule,
    TransactionHistoryModule,
    WalletStatementModule,
    AnalyticsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
