import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { Public } from '../decorators/public.decorator';

@ApiTags('delivery')
@Public()
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('zones')
  @ApiOperation({ summary: 'Delivery zones, fees and estimated timelines' })
  listZones() {
    return this.delivery.listZones();
  }
}
