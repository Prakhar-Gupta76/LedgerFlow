import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const optionalTrim = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  return value.trim() || undefined;
};

export class NotificationsQueryDto {
  @Transform(optionalTrim)
  @IsOptional()
  @IsIn(["ALL", "UNREAD"])
  state: "ALL" | "UNREAD" = "ALL";

  @Transform(optionalTrim)
  @IsOptional()
  @IsIn([
    "WELCOME",
    "WALLET_FUNDED",
    "TRANSFER_SENT",
    "TRANSFER_RECEIVED",
    "TRANSFER_FAILED",
    "TRANSFER_REVERSED",
    "WALLET_STATUS_CHANGED",
    "ACCOUNT_SECURITY",
    "SYSTEM_MESSAGE",
  ])
  type?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsIn(["INFO", "WARNING", "CRITICAL"])
  severity?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
