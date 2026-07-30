import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

export class LookupRecipientDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;
}
