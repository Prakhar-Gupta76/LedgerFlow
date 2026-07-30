import { Transform, Type } from "class-transformer";
import {
  IsDateString,
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

export class StatementQueryDto {
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
  limit = 25;
}
