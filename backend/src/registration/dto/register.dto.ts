import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

function normalizePhone(value: unknown) {
  if (typeof value !== "string") return value;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return value.trim();
}

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
  )
  @IsString()
  @Length(2, 100)
  fullName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(({ value }: { value: unknown }) => normalizePhone(value))
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: "phoneNumber must use E.164 format",
  })
  phoneNumber: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[A-Z]/, { message: "password must contain an uppercase letter" })
  @Matches(/\d/, { message: "password must contain a number" })
  @Matches(/[^A-Za-z0-9]/, {
    message: "password must contain a special character",
  })
  password: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsUUID("4", { each: true })
  acceptedLegalDocumentIds: string[];
}
