import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuthenticationModule } from "../authentication/authentication.module";
import { AdminLedgerController } from "./admin-ledger.controller";
import { AdminLedgerService } from "./admin-ledger.service";
@Module({ imports: [DatabaseModule, AuthenticationModule], controllers: [AdminLedgerController], providers: [AdminLedgerService] })
export class AdminLedgerModule { }
