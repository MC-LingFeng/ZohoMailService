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
import type { Folder } from './types';

export class LoginDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional() @IsString() @MaxLength(80) username?: string;
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
  @IsOptional() @IsIn(['inbox', 'spam', 'sent', 'other']) folder: Folder = 'inbox';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(256) folderId?: string;
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
