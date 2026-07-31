import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
