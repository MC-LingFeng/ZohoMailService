import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ListRebatesDto, RebateDto } from './rebates.dto';
import { MailStore } from './store';

@Controller('rebates')
export class RebatesController {
  constructor(private readonly store: MailStore) {}

  @Get()
  list(@Query() query: ListRebatesDto) {
    return this.store.rebates(query);
  }

  @Get('options')
  options() {
    return this.store.rebateOptions();
  }

  @Post()
  create(@Body() dto: RebateDto) {
    return this.store.createRebate(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: RebateDto) {
    return this.store.updateRebate(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.store.removeRebate(id);
  }
}
