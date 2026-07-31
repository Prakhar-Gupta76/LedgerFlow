import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { AdminDashboardService } from "./admin-dashboard.service";

@Controller("admin")
@UseGuards(AccessTokenGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get("dashboard")
  getDashboard(@Req() request: AuthenticatedRequest) {
    return this.dashboard.getDashboard(request.user.sub, request.user.role);
  }
}
