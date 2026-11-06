import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, Equals, IsArray, IsBase64, IsBoolean,
  IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { FingerprintBrowserInput, FingerprintBrowserQuery } from './fingerprint-browsers.types';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class FingerprintBrowserDto implements FingerprintBrowserInput {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '请填写序号' })
  @MaxLength(100)
  serialNumber!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '请填写指纹浏览器 ID' })
  @MaxLength(128)
  browserId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: '请填写窗口名称' })
  @MaxLength(200)
  windowName!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  proxyInfo = '';

  @IsArray()
  @ArrayMaxSize(2000)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  accountIds: string[] = [];
}

export class ListFingerprintBrowsersDto implements FingerprintBrowserQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search = '';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class FingerprintBrowserFileDto {
  @IsString()
  @MaxLength(255)
  @Matches(/\.xlsx$/i, { message: '请上传 .xlsx 格式的 Excel 文件' })
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  @IsBase64({}, { message: 'Excel 文件内容无效，请重新选择文件' })
  @MaxLength(6_990_508, { message: 'Excel 文件不能超过 5 MB' })
  content!: string;
}

export class ImportFingerprintBrowsersDto extends FingerprintBrowserFileDto {
  @IsBoolean()
  @Equals(true, { message: '导入将全部替换指纹浏览器，请先确认替换' })
  confirmReplace!: boolean;
}
