import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { AdminWalletsService } from "./admin-wallets.service";
import { AdminWalletsQueryDto } from "./dto/admin-wallets-query.dto";
import { ReactivateWalletDto, WalletActionDto } from "./dto/wallet-action.dto";

@Controller("admin/wallets")
@UseGuards(AccessTokenGuard)
export class AdminWalletsController {
  constructor(private readonly wallets: AdminWalletsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminWalletsQueryDto,
  ) {
    return this.wallets.list(request.user.sub, request.user.role, query);
  }

  @Get(":walletId")
  details(
    @Req() request: AuthenticatedRequest,
    @Param("walletId") walletId: string,
  ) {
    return this.wallets.details(request.user.sub, request.user.role, walletId);
  }

  @Patch(":walletId/suspend")
  suspend(
    @Req() request: AuthenticatedRequest,
    @Param("walletId") walletId: string,
    @Body() dto: WalletActionDto,
  ) {
    return this.wallets.suspend(
      request.user.sub,
      request.user.role,
      walletId,
      dto,
      this.context(request),
    );
  }

  @Patch(":walletId/reactivate")
  reactivate(
    @Req() request: AuthenticatedRequest,
    @Param("walletId") walletId: string,
    @Body() dto: ReactivateWalletDto,
  ) {
    return this.wallets.reactivate(
      request.user.sub,
      request.user.role,
      walletId,
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
