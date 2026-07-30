import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { TransactionHistoryController } from "./transaction-history.controller";
import { TransactionHistoryService } from "./transaction-history.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [TransactionHistoryController],
  providers: [TransactionHistoryService],
})
export class TransactionHistoryModule {}
