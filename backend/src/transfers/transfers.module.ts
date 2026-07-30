import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { TransfersController } from "./transfers.controller";
import { TransfersService } from "./transfers.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
