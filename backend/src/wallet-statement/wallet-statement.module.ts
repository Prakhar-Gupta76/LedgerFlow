import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { WalletStatementController } from "./wallet-statement.controller";
import { WalletStatementService } from "./wallet-statement.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [WalletStatementController],
  providers: [WalletStatementService],
})
export class WalletStatementModule {}
