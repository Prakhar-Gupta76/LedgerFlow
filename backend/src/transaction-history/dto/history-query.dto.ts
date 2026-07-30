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

export class HistoryQueryDto {
  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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
  @IsIn([
    "TRANSFER_SENT",
    "TRANSFER_RECEIVED",
    "FUNDS_ADDED",
    "TRANSFER_REVERSED",
  ])
  activityType?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsIn(["DEBIT", "CREDIT"])
  direction?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsIn(["PENDING", "COMPLETED", "FAILED", "REVERSED"])
  status?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  minAmountMinor?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  maxAmountMinor?: number;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
