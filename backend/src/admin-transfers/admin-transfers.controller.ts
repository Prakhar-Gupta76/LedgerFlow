import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { AdminTransfersService } from "./admin-transfers.service";
import { AdminTransfersQueryDto } from "./dto/admin-transfers-query.dto";

@Controller("admin/transfers")
@UseGuards(AccessTokenGuard)
export class AdminTransfersController {
  constructor(private readonly transfers: AdminTransfersService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AdminTransfersQueryDto,
  ) {
    return this.transfers.list(request.user.sub, request.user.role, query);
  }

  @Get(":transferId")
  details(
    @Req() request: AuthenticatedRequest,
    @Param("transferId") transferId: string,
  ) {
    return this.transfers.details(
      request.user.sub,
      request.user.role,
      transferId,
    );
  }
}
