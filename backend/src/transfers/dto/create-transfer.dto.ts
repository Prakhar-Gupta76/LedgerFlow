import { Transform } from "class-transformer";
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class CreateTransferDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MaxLength(24)
  @Matches(/^LF[A-Z0-9]+$/)
  recipientWalletNumber!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  @Equals("INR")
  currency!: "INR";

  @Transform(({ value }) => {
    if (typeof value !== "string") return value;
    return value.trim() || undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @IsUUID("4")
  idempotencyKey!: string;
}
