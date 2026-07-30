import { Module } from "@nestjs/common";
import { AuthenticationModule } from "../authentication/authentication.module";
import { DatabaseModule } from "../database/database.module";
import { NotificationWorkerService } from "./notification-worker.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [DatabaseModule, AuthenticationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationWorkerService],
})
export class NotificationsModule {}
