import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminDashboardModule } from "./admin-dashboard/admin-dashboard.module";
import { AdminLedgerModule } from "./admin-ledger/admin-ledger.module";
import { AdminUsersModule } from "./admin-users/admin-users.module";
import { AdminTransfersModule } from "./admin-transfers/admin-transfers.module";
import { AdminWalletsModule } from "./admin-wallets/admin-wallets.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthenticationModule } from "./authentication/authentication.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { FundingModule } from "./funding/funding.module";
import { HealthController } from "./health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { RegistrationModule } from "./registration/registration.module";
import { SettingsModule } from "./settings/settings.module";
import { TransactionHistoryModule } from "./transaction-history/transaction-history.module";
import { TransfersModule } from "./transfers/transfers.module";
import { WalletStatementModule } from "./wallet-statement/wallet-statement.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
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
    SettingsModule,
    AdminDashboardModule,
    AdminLedgerModule,
    AdminUsersModule,
    AdminWalletsModule,
    AdminTransfersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
