import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from "class-validator";

export class LedgerQueryDto {
  @IsOptional() @IsIn(["DEBIT", "CREDIT"]) entryType?: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class StartReconciliationDto {
  @IsIn(["GLOBAL_TRIAL_BALANCE","LEDGER_TRANSACTION_BALANCE","WALLET_BALANCE","TRANSFER_POSTING","FUNDING_POSTING"]) runType!: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsUUID() walletId?: string;
}
export class FindingActionDto {
  @IsIn(["UNDER_REVIEW","RESOLVED","ACCEPTED_EXCEPTION"]) status!: string;
  @IsString() @Length(3, 500) resolutionNote!: string;
}
export class AdjustmentLineDto {
  @IsUUID() ledgerAccountId!: string;
  @IsIn(["DEBIT", "CREDIT"]) entryType!: "DEBIT" | "CREDIT";
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
export class CreateAdjustmentDto {
  @IsOptional() @IsUUID() findingId?: string;
  @IsIn(["FULL_REVERSAL","CORRECTIVE_POSTING","WALLET_BALANCE_CORRECTION"]) adjustmentType!: string;
  @IsOptional() @IsUUID() targetLedgerTransactionId?: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsString() @Length(3, 100) reasonCode!: string;
  @IsString() @Length(3, 500) reason!: string;
  @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => AdjustmentLineDto) lines!: AdjustmentLineDto[];
}
export class AdjustmentDecisionDto {
  @IsString() @Length(3, 500) resolutionNote!: string;
}
