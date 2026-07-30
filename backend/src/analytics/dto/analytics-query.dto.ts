import { Transform } from "class-transformer";
import { IsDateString, IsOptional } from "class-validator";

const optionalTrim = ({ value }: { value: unknown }) => {
  if (typeof value !== "string") return value;
  return value.trim() || undefined;
};

export class AnalyticsQueryDto {
  @Transform(optionalTrim)
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}
