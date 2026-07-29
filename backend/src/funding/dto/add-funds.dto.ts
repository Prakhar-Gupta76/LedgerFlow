import { Equals, IsInt, IsUUID, Max, Min } from "class-validator";

export class AddFundsDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  @Equals("INR")
  currency!: "INR";

  @Equals("SIMULATED")
  sourceType!: "SIMULATED";

  @IsUUID("4")
  idempotencyKey!: string;
}
