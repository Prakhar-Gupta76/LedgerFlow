import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { AnalyticsQueryDto } from "./dto/analytics-query.dto";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
@UseGuards(AccessTokenGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  getAnalytics(
    @Req() request: AuthenticatedRequest,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.getAnalytics(request.user.sub, query);
  }
}
