import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { AddFundsDto } from "./dto/add-funds.dto";
import { FundingService } from "./funding.service";

@Controller("wallet")
@UseGuards(AccessTokenGuard)
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  @Get("funding-context")
  getContext(@Req() request: AuthenticatedRequest) {
    return this.funding.getContext(request.user.sub);
  }

  @Post("add-funds")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  addFunds(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AddFundsDto,
  ) {
    return this.funding.addFunds(request.user.sub, dto);
  }
}
