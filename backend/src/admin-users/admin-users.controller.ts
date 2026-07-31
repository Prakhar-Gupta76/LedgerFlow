import {
  Body,
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
import { AdminUsersService } from "./admin-users.service";
import { AdminUsersQueryDto } from "./dto/admin-users-query.dto";
import { ClosureReviewDto } from "./dto/closure-review.dto";
import {
  ReactivateUserDto,
  RevokeSessionsDto,
  UserActionDto,
} from "./dto/user-action.dto";

@Controller("admin/users")
@UseGuards(AccessTokenGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminUsersQueryDto,
  ) {
    return this.users.list(request.user.sub, request.user.role, query);
  }

  @Get(":userId")
  details(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
  ) {
    return this.users.details(request.user.sub, request.user.role, userId);
  }

  @Patch(":userId/suspend")
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() dto: UserActionDto,
  ) {
    return this.users.suspend(
      request.user.sub,
      request.user.role,
      userId,
      dto,
      this.context(request),
    );
  }

  @Patch(":userId/reactivate")
  reactivate(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() dto: ReactivateUserDto,
  ) {
    return this.users.reactivate(
      request.user.sub,
      request.user.role,
      userId,
      dto,
      this.context(request),
    );
  }

  @Patch(":userId/sessions/revoke")
  revokeSessions(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() dto: RevokeSessionsDto,
  ) {
    return this.users.revokeSessions(
      request.user.sub,
      request.user.role,
      userId,
      dto,
      this.context(request),
    );
  }

  @Patch(":userId/closure-requests/:requestId/review")
  reviewClosure(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Param("requestId") requestId: string,
    @Body() dto: ClosureReviewDto,
  ) {
    return this.users.reviewClosure(
      request.user.sub,
      request.user.role,
      userId,
      requestId,
      dto,
      this.context(request),
    );
  }

  private context(request: AuthenticatedRequest) {
    return {
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    };
  }
}
