import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { WorkspaceRole } from './platform-store';

export class WorkspaceDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
}
export class CreateUserDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(80) username!: string;
  @IsString() @MinLength(12) @MaxLength(256) password!: string;
}
export class AddWorkspaceMemberDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @IsNotEmpty() @MaxLength(80) username!: string;
  @IsOptional() @IsIn(['owner', 'member']) role: WorkspaceRole = 'member';
}
export class UpdateWorkspaceMemberDto {
  @IsIn(['owner', 'member']) role!: WorkspaceRole;
}
export class ChangePasswordDto {
  @IsString() @MaxLength(256) currentPassword!: string;
  @IsString() @MinLength(12) @MaxLength(256) password!: string;
}
