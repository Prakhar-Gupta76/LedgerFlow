import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common"; import { AccessTokenGuard, AuthenticatedRequest } from "../authentication/access-token.guard"; import { AdminJobsService } from "./admin-jobs.service"; import { AdminJobsQueryDto, RetryJobDto } from "./dto/admin-jobs.dto";
@Controller("admin/jobs")
@UseGuards(AccessTokenGuard)
export class AdminJobsController {
    constructor(private readonly jobs: AdminJobsService) { }
    @Get() list(@Req() r: AuthenticatedRequest, @Query() q: AdminJobsQueryDto) {
        return this.jobs.list(r.user.sub, r.user.role, q)
    }
    @Get(":id") details(@Req() r: AuthenticatedRequest, @Param("id") id: string) {
        return this.jobs.details(r.user.sub, r.user.role, id)
    }
    @Post(":id/retry-requests") retry(@Req() r: AuthenticatedRequest, @Param("id") id: string, @Body() d: RetryJobDto) {
        return this.jobs.requestRetry(r.user.sub, r.user.role, id, d)
    }
}
