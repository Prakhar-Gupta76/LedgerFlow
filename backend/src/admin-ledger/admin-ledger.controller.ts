import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard, AuthenticatedRequest } from "../authentication/access-token.guard";
import { AdminLedgerService } from "./admin-ledger.service";
import { AdjustmentDecisionDto, CreateAdjustmentDto, FindingActionDto, LedgerQueryDto, StartReconciliationDto } from "./dto/ledger.dto";

@Controller("admin/ledger")
@UseGuards(AccessTokenGuard)
export class AdminLedgerController {
  constructor(private readonly ledger: AdminLedgerService) { }
  @Get() overview(@Req() req: AuthenticatedRequest, @Query() query: LedgerQueryDto) { return this.ledger.overview(req.user.sub, req.user.role, query) }
  @Post("reconciliation-runs") start(@Req() req: AuthenticatedRequest, @Body() dto: StartReconciliationDto) { return this.ledger.startRun(req.user.sub, req.user.role, dto) }
  @Patch("findings/:id") finding(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: FindingActionDto) { return this.ledger.updateFinding(req.user.sub, req.user.role, id, dto) }
  @Post("adjustments") adjustment(@Req() req: AuthenticatedRequest, @Body() dto: CreateAdjustmentDto) { return this.ledger.createAdjustment(req.user.sub, req.user.role, dto) }
  @Patch("adjustments/:id/submit") submit(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.ledger.submitAdjustment(req.user.sub, req.user.role, id) }
  @Patch("adjustments/:id/approve") approve(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: AdjustmentDecisionDto) { return this.ledger.decideAdjustment(req.user.sub, req.user.role, id, "APPROVED", dto) }
  @Patch("adjustments/:id/reject") reject(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: AdjustmentDecisionDto) { return this.ledger.decideAdjustment(req.user.sub, req.user.role, id, "REJECTED", dto) }
  @Post("adjustments/:id/execute") execute(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.ledger.executeAdjustment(req.user.sub, req.user.role, id) }
  @Patch("adjustments/:id/cancel") cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.ledger.cancelAdjustment(req.user.sub, req.user.role, id) }
}
