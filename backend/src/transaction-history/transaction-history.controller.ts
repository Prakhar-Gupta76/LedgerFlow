import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { HistoryQueryDto } from "./dto/history-query.dto";
import { TransactionHistoryService } from "./transaction-history.service";

@Controller("transactions")
@UseGuards(AccessTokenGuard)
export class TransactionHistoryController {
  constructor(private readonly history: TransactionHistoryService) {}

  @Get()
  getHistory(
    @Req() request: AuthenticatedRequest,
    @Query() query: HistoryQueryDto,
  ) {
    return this.history.getHistory(request.user.sub, query);
  }

  @Get("export")
  async exportCsv(
    @Req() request: AuthenticatedRequest,
    @Query() query: HistoryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.history.exportCsv(request.user.sub, query);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ledgerflow-transactions-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    );
    return csv;
  }

  @Get(":transactionId")
  getDetails(
    @Req() request: AuthenticatedRequest,
    @Param("transactionId") transactionId: string,
  ) {
    return this.history.getDetails(request.user.sub, transactionId);
  }
}
