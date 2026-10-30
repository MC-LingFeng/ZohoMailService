import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  read() {
    return this.settings.read();
  }

  @Patch()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto.revision, dto.values);
  }
}
