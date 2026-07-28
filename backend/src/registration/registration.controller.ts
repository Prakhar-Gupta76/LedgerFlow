import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { RegisterDto } from "./dto/register.dto";
import { RegistrationService } from "./registration.service";

@Controller("auth")
export class RegistrationController {
  constructor(private readonly registration: RegistrationService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.registration.register(dto, {
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    });
  }
}
