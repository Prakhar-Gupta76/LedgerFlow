import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { FundingController } from "./funding.controller";
import { FundingService } from "./funding.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [FundingController],
  providers: [FundingService],
})
export class FundingModule {}
