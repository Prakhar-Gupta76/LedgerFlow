import { Transform } from "class-transformer";
import { IsString, Length } from "class-validator";

export class UpdateProfileDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
  )
  @IsString()
  @Length(2, 100)
  fullName: string;
}
