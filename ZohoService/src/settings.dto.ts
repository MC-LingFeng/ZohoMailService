import { IsObject, IsString, Matches } from 'class-validator';

export class UpdateSettingsDto {
  @IsString({ message: '配置版本无效，请重新加载' })
  @Matches(/^[a-f0-9]{64}$/, { message: '配置版本无效，请重新加载' })
  revision!: string;

  @IsObject({ message: '配置内容必须为键值对象' })
  values!: Record<string, string>;
}
