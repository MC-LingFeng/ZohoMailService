import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsFQDN,
  IsIn,
  IsInt,
  IsIP,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RebateInput, RebateQuery } from './rebates.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

function normalizeDomain({ value }: { value: unknown }) {
  if (typeof value !== 'string') return value;
  const original = value.trim().toLowerCase();
  try {
    const url = new URL(
      original.includes('://') ? original : `https://${original}`,
    );
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return original;
    return url.hostname;
  } catch {
    return original;
  }
}

export class RebateDto implements RebateInput {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  accountId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  siteName!: string;

  @Transform(normalizeDomain)
  @IsFQDN({}, { message: '域名格式不正确，请填写 example.com 或完整网址' })
  @MaxLength(253)
  domain!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '创建时间须为 YYYY-MM-DD' })
  @IsDateString({ strict: true }, { message: '创建时间不是有效日期' })
  registeredAt!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(200)
  offerName = '';

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  totalRevenue = 0;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000_000)
  totalCost = 0;

  @IsBoolean()
  settled = false;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  settlementCycle = '';

  @IsBoolean()
  banned = false;

  @Transform(trim)
  @ValidateIf((record: RebateDto) => record.ip !== '')
  @IsIP(undefined, { message: 'IP 须为有效的 IPv4 或 IPv6 地址' })
  @MaxLength(45)
  ip = '';
}

export class ListRebatesDto implements RebateQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  search = '';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(256)
  accountId = '';

  @IsOptional()
  @IsIn(['all', 'yes', 'no'])
  settled: RebateQuery['settled'] = 'all';

  @IsOptional()
  @IsIn(['all', 'yes', 'no'])
  banned: RebateQuery['banned'] = 'all';

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
