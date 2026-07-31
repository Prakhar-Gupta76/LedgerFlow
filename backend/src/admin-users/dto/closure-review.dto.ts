import { Transform } from "class-transformer";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

export class ClosureReviewDto {
  @IsIn(["APPROVE", "REJECT", "COMPLETE"])
  action: "APPROVE" | "REJECT" | "COMPLETE";

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolutionNote: string;
}
