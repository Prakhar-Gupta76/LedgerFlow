import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { LookupRecipientDto } from "./dto/lookup-recipient.dto";
import { TransfersService } from "./transfers.service";

@Controller("transfers")
@UseGuards(AccessTokenGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get("context")
  getContext(@Req() request: AuthenticatedRequest) {
    return this.transfers.getContext(request.user.sub);
  }

  @Get("result/:transferId")
  getTransferResult(
    @Req() request: AuthenticatedRequest,
    @Param("transferId", new ParseUUIDPipe()) transferId: string,
  ) {
    return this.transfers.getTransferResult(request.user.sub, transferId);
  }

  @Get("recipients/lookup")
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  lookupRecipient(
    @Req() request: AuthenticatedRequest,
    @Query() query: LookupRecipientDto,
  ) {
    return this.transfers.lookupRecipient(request.user.sub, query.identifier);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createTransfer(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateTransferDto,
  ) {
    return this.transfers.createTransfer(request.user.sub, dto);
  }
}
