import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class UserActionDto {
  @IsIn([
    "SUSPICIOUS_ACTIVITY",
    "POLICY_VIOLATION",
    "SECURITY_REVIEW",
    "CUSTOMER_REQUEST",
    "OTHER",
  ])
  reasonCode: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class ReactivateUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class RevokeSessionsDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
