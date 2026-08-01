import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class AdminTransfersQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(100)
  participant?: string;

  @IsOptional()
  @IsUUID()
  initiatorUserId?: string;

  @IsOptional()
  @IsIn(["PENDING", "COMPLETED", "FAILED", "REVERSED"])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  failureCode?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toUpperCase() : value,
  )
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinMinor?: number;

  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMaxMinor?: number;

  @IsOptional()
  @IsDateString()
  initiatedFrom?: string;

  @IsOptional()
  @IsDateString()
  initiatedTo?: string;

  @IsOptional()
  @IsIn(["HEALTHY", "MISSING", "FAILED", "RETRYING"])
  jobHealth?: string;

  @Transform(({ value }: { value: unknown }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}
