import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

export type AccessTokenUser = {
  sub: string;
  role: "CUSTOMER" | "ADMIN";
  sid?: string;
};

export type AuthenticatedRequest = Request & {
  user: AccessTokenUser;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const secret = config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new Error("JWT_ACCESS_SECRET is required.");
    this.secret = secret;
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw this.unauthorized();

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenUser>(token, {
        secret: this.secret,
        issuer: "ledgerflow-api",
        audience: "ledgerflow-web",
      });
      return true;
    } catch {
      throw this.unauthorized();
    }
  }

  private unauthorized() {
    return new UnauthorizedException({
      code: "ACCESS_TOKEN_INVALID",
      message: "Your session has expired. Please log in again.",
    });
  }
}
