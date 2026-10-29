import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(256) password!: string;
}
export class BindAccountDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  clientId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  clientSecret!: string;
}
export class ListMessagesDto {
  @IsOptional() @IsIn(['inbox', 'spam', 'sent']) folder:
    | 'inbox'
    | 'spam'
    | 'sent' = 'inbox';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) start = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30;
  @IsOptional() @IsString() @MaxLength(200) q = '';
}
export class SendDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  to!: string;
  @IsString() @IsNotEmpty() @MaxLength(998) subject!: string;
  @IsString() @IsNotEmpty() @MaxLength(200000) content!: string;
}
export class UpdateAccountDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(80) group?: string;
}
