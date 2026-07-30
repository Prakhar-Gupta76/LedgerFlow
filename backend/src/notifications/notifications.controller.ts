import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { NotificationsQueryDto } from "./dto/notifications-query.dto";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(AccessTokenGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  getNotifications(
    @Req() request: AuthenticatedRequest,
    @Query() query: NotificationsQueryDto,
  ) {
    return this.notifications.getNotifications(request.user.sub, query);
  }

  @Patch("read-all")
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.user.sub);
  }

  @Patch(":notificationId/read")
  markRead(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notifications.markRead(request.user.sub, notificationId);
  }
}
