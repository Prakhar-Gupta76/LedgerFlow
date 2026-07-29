import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ResetPasswordDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[A-Z]/, { message: "password must contain an uppercase letter" })
  @Matches(/\d/, { message: "password must contain a number" })
  @Matches(/[^A-Za-z0-9]/, {
    message: "password must contain a special character",
  })
  password!: string;
}
