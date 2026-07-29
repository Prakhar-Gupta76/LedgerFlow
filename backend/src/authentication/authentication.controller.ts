import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { AuthenticationService } from "./authentication.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";

const REFRESH_COOKIE = "ledgerflow_refresh";

@Controller("auth")
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authentication.login(dto, this.context(request));
    this.setRefreshCookie(
      response,
      result.refreshToken,
      result.refreshTokenExpiresAt,
    );
    const { refreshToken, refreshTokenExpiresAt, ...publicResult } = result;
    void refreshToken;
    void refreshTokenExpiresAt;
    return publicResult;
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 15 * 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException({
        code: "SESSION_INVALID",
        message: "Your session has expired. Please log in again.",
      });
    }
    const result = await this.authentication.refresh(token);
    this.setRefreshCookie(
      response,
      result.refreshToken,
      result.refreshTokenExpiresAt,
    );
    const { refreshToken, refreshTokenExpiresAt, ...publicResult } = result;
    void refreshToken;
    void refreshTokenExpiresAt;
    return publicResult;
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.authentication.logout(token, this.context(request));
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/v1/auth",
    });
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request) {
    return this.authentication.requestPasswordReset(dto, this.context(request));
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    return this.authentication.resetPassword(dto, this.context(request));
  }

  private setRefreshCookie(
    response: Response,
    token: string,
    expires: Date,
  ) {
    response.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires,
      path: "/api/v1/auth",
    });
  }

  private context(request: Request) {
    return {
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    };
  }
}
