import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(AccessTokenGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  getDashboard(@Req() request: AuthenticatedRequest) {
    return this.dashboard.getDashboard(request.user.sub);
  }

  @Patch("notifications/:notificationId/read")
  markNotificationRead(
    @Req() request: AuthenticatedRequest,
    @Param("notificationId", new ParseUUIDPipe()) notificationId: string,
  ) {
    return this.dashboard.markNotificationRead(
      request.user.sub,
      notificationId,
    );
  }
}
