import { Transform } from "class-transformer";
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateClosureRequestDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== "string") return value;
    return value.trim() || undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
