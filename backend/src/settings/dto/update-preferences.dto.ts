import { IsBoolean } from "class-validator";

export class UpdatePreferencesDto {
  @IsBoolean()
  walletFundingEnabled: boolean;

  @IsBoolean()
  transferSentEnabled: boolean;

  @IsBoolean()
  transferReceivedEnabled: boolean;

  @IsBoolean()
  transferFailedEnabled: boolean;

  @IsBoolean()
  transferReversedEnabled: boolean;

  @IsBoolean()
  systemMessagesEnabled: boolean;
}
