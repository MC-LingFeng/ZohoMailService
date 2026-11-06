import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { FingerprintBrowserDto, FingerprintBrowserFileDto, ImportFingerprintBrowsersDto, ListFingerprintBrowsersDto } from './fingerprint-browsers.dto';
import { parseFingerprintBrowserWorkbook } from './fingerprint-browsers.import';
import { MailStore } from './store';

@Controller('fingerprint-browsers')
export class FingerprintBrowsersController {
  constructor(private readonly store: MailStore) {}

  @Get()
  list(@Query() query: ListFingerprintBrowsersDto) {
    return this.store.fingerprintBrowsers(query);
  }

  @Get('options')
  options() {
    return this.store.fingerprintBrowserOptions();
  }

  @Post()
  create(@Body() dto: FingerprintBrowserDto) {
    return this.store.createFingerprintBrowser(dto);
  }

  @Post('import-preview')
  @HttpCode(200)
  async preview(@Body() dto: FingerprintBrowserFileDto) {
    const records = await parseFingerprintBrowserWorkbook(dto);
    return { records, count: records.length };
  }

  @Post('import')
  @HttpCode(200)
  async import(@Body() dto: ImportFingerprintBrowsersDto) {
    return this.store.replaceFingerprintBrowsers(await parseFingerprintBrowserWorkbook(dto));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: FingerprintBrowserDto) {
    return this.store.updateFingerprintBrowser(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.store.removeFingerprintBrowser(id);
  }
}
