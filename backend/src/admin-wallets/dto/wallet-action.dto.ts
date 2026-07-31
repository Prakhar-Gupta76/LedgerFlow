import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class WalletActionDto {
  @IsIn([
    "SUSPICIOUS_ACTIVITY",
    "SECURITY_REVIEW",
    "POLICY_VIOLATION",
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

export class ReactivateWalletDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
