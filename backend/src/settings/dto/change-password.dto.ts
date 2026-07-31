import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[A-Z]/, { message: "newPassword must contain an uppercase letter" })
  @Matches(/\d/, { message: "newPassword must contain a number" })
  @Matches(/[^A-Za-z0-9]/, {
    message: "newPassword must contain a special character",
  })
  newPassword: string;
}
