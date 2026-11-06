import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import readExcelFile from 'read-excel-file/universal';
import { FingerprintBrowserDto, FingerprintBrowserFileDto } from './fingerprint-browsers.dto';
import { FingerprintBrowserImportInput } from './fingerprint-browsers.types';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
const requiredHeaders = ['序号', 'ID', '窗口名称'] as const;
const normalizeHeader = (value: unknown) => typeof value === 'string' ? value.replace(/^\uFEFF/, '').trim().toUpperCase() : '';

// Check the ZIP directory before decompressing a workbook. The workbook is only
// read in memory; uploads and unrelated export columns are never persisted.
function validateArchive(buffer: Buffer) {
  let end = buffer.length - 22;
  const lower = Math.max(0, buffer.length - 65_557);
  for (; end >= lower; end--) {
    if (buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length) break;
  }
  if (end < lower) throw new BadRequestException('Excel 文件无效，请重新导出 .xlsx 文件');
  const entries = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || !entries || entries > 3000 ||
      offset + directorySize > end) throw new BadRequestException('Excel 文件结构无效或包含过多资源，请重新导出');
  let expandedSize = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new BadRequestException('Excel 文件已损坏，请重新导出');
    if (buffer.readUInt16LE(offset + 8) & 1)
      throw new BadRequestException('暂不支持加密的 Excel 文件，请先解除文件加密');
    expandedSize += buffer.readUInt32LE(offset + 24);
    if (expandedSize > 32 * 1024 * 1024)
      throw new BadRequestException('Excel 解压后内容过大，请仅保留要导入的数据');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  if (offset > end) throw new BadRequestException('Excel 文件已损坏，请重新导出');
}

function parseRows(rows: unknown[][]): FingerprintBrowserImportInput[] | null {
  const headerIndex = rows.slice(0, 10).findIndex((row) => requiredHeaders.every((header) => row.some((cell) => normalizeHeader(cell) === header)));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex].map(normalizeHeader);
  for (const name of [...requiredHeaders, '代理信息']) {
    if (headers.filter((header) => header === name).length > 1)
      throw new BadRequestException(`导入表中“${name}”列重复，请检查表头`);
  }
  const column = (name: string) => headers.indexOf(name);
  const records: FingerprintBrowserImportInput[] = [];
  const serials = new Set<string>();
  const browserIds = new Set<string>();
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const cell = (name: string) => {
      const value = row[column(name)];
      if (value === null || value === undefined) return '';
      if (typeof value !== 'string' && typeof value !== 'number')
        throw new BadRequestException(`第 ${index + 1} 行“${name}”须为文本，请检查单元格格式`);
      return String(value).trim();
    };
    const input = {
      serialNumber: cell('序号'), browserId: cell('ID'),
      windowName: cell('窗口名称'), proxyInfo: cell('代理信息'),
    };
    if (!Object.values(input).some(Boolean)) continue;
    // The supplied window export has a merged instruction row immediately below
    // its header, followed by the actual data. It is not a browser record.
    if (index === headerIndex + 1 && !input.serialNumber && !input.browserId && !input.proxyInfo && /^说明[：:]/.test(input.windowName)) continue;
    const errors = validateSync(plainToInstance(FingerprintBrowserDto, input));
    if (errors.length) {
      const labels: Record<string, string> = { serialNumber: '序号', browserId: 'ID', windowName: '窗口名称', proxyInfo: '代理信息' };
      throw new BadRequestException(`第 ${index + 1} 行的${errors.map((error) => labels[error.property] || error.property).join('、')}为空、类型或长度不正确，请修正后重新导入`);
    }
    if (serials.has(input.serialNumber)) throw new BadRequestException(`第 ${index + 1} 行序号重复，导入已取消`);
    if (browserIds.has(input.browserId)) throw new BadRequestException(`第 ${index + 1} 行 ID 重复，导入已取消`);
    serials.add(input.serialNumber);
    browserIds.add(input.browserId);
    records.push(input);
    if (records.length > MAX_ROWS) throw new BadRequestException(`每次最多导入 ${MAX_ROWS} 条指纹浏览器`);
  }
  if (!records.length) throw new BadRequestException('Excel 中没有可导入的指纹浏览器，未替换现有数据');
  return records;
}

export async function parseFingerprintBrowserWorkbook(file: FingerprintBrowserFileDto): Promise<FingerprintBrowserImportInput[]> {
  const buffer = Buffer.from(file.content, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_SIZE)
    throw new BadRequestException('请选择不超过 5 MB 的 .xlsx 文件');
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50)
    throw new BadRequestException('Excel 文件无效，请选择 .xlsx 格式文件');
  validateArchive(buffer);
  try {
    // Numeric identifiers stay strings, avoiding rounding of long IDs. The source
    // export already stores hexadecimal IDs as text and serial numbers as numbers.
    const sheets = await readExcelFile<string>(new Uint8Array(buffer).buffer, {
      parseNumber: (value) => value.replace(/^([+-]?\d+)\.0+$/, '$1'),
    });
    const ordered = [...sheets].sort((a, b) => Number(b.sheet === '导出窗口') - Number(a.sheet === '导出窗口'));
    for (const sheet of ordered) {
      const records = parseRows(sheet.data);
      if (records) return records;
    }
    throw new BadRequestException('未找到导入表头，须包含“序号”“ID”“窗口名称”，代理信息可留空');
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('无法读取 Excel，请确认文件未损坏且为有效的 .xlsx 格式');
  }
}
