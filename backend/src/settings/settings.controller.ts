import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  AccessTokenGuard,
  AuthenticatedRequest,
} from "../authentication/access-token.guard";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { CreateClosureRequestDto } from "./dto/create-closure-request.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(AccessTokenGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getSettings(@Req() request: AuthenticatedRequest) {
    return this.settings.getSettings(request.user.sub, request.user.sid);
  }

  @Patch("profile")
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.settings.updateProfile(request.user.sub, dto);
  }

  @Patch("notification-preferences")
  updatePreferences(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.settings.updatePreferences(request.user.sub, dto);
  }

  @Post("password")
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.settings.changePassword(
      request.user.sub,
      request.user.sid,
      dto,
      this.context(request),
    );
  }

  @Patch("sessions/revoke-others")
  revokeOtherSessions(@Req() request: AuthenticatedRequest) {
    return this.settings.revokeOtherSessions(
      request.user.sub,
      request.user.sid,
      this.context(request),
    );
  }

  @Patch("sessions/:sessionId/revoke")
  async revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.settings.revokeSession(
      request.user.sub,
      request.user.sid,
      sessionId,
      this.context(request),
    );
    if (result.currentSessionRevoked) this.clearRefreshCookie(response);
    return result;
  }

  @Post("closure-requests")
  requestClosure(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateClosureRequestDto,
  ) {
    return this.settings.requestClosure(
      request.user.sub,
      dto,
      this.context(request),
    );
  }

  @Patch("closure-requests/:requestId/cancel")
  cancelClosure(
    @Req() request: AuthenticatedRequest,
    @Param("requestId") requestId: string,
  ) {
    return this.settings.cancelClosure(request.user.sub, requestId);
  }

  private context(request: AuthenticatedRequest) {
    return {
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    };
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie("ledgerflow_refresh", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/v1/auth",
    });
  }
}
