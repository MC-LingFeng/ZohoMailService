import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ListRebatesDto, RebateDto } from './rebates.dto';
import { MailStore } from './store';
import { RebateCostsService } from './rebate-costs.service';

@Controller('rebates')
export class RebatesController {
  constructor(
    private readonly store: MailStore,
    private readonly costs: RebateCostsService,
  ) {}

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

  @Post('refresh-costs')
  @HttpCode(200)
  refreshCosts() {
    return this.costs.refresh();
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
