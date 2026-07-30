import {
  Controller,
  Get,
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
import { StatementQueryDto } from "./dto/statement-query.dto";
import { WalletStatementService } from "./wallet-statement.service";

@Controller("wallet/statement")
@UseGuards(AccessTokenGuard)
export class WalletStatementController {
  constructor(private readonly statement: WalletStatementService) {}

  @Get()
  getStatement(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatementQueryDto,
  ) {
    return this.statement.getStatement(request.user.sub, query);
  }

  @Get("export")
  async exportCsv(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatementQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.statement.exportCsv(request.user.sub, query);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="ledgerflow-statement-${result.period.dateFrom}-to-${result.period.dateTo}.csv"`,
    );
    return result.csv;
  }
}
