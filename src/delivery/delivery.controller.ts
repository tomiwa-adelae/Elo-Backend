import { Controller, Get, Query } from '@nestjs/common';
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
  listZones(@Query('currency') currency?: string) {
    return this.delivery.listZones(currency === 'USD' ? 'USD' : 'NGN');
  }

  @Get('estimate')
  @ApiOperation({
    summary: 'Fee and free-delivery threshold for an address, before checkout',
  })
  async estimate(
    @Query('countryCode') countryCode = 'NG',
    @Query('state') state = '',
    @Query('city') city = '',
    @Query('currency') currency?: string,
  ) {
    const cur = currency === 'USD' ? 'USD' : 'NGN';
    try {
      const d = await this.delivery.resolve(
        {
          countryCode: countryCode.slice(0, 2).toUpperCase(),
          state: state.slice(0, 60),
          city: city.slice(0, 80),
        },
        0,
        cur,
      );
      return {
        currency: cur,
        zoneName: d.zoneName,
        feeKobo: d.feeKobo,
        freeAboveKobo: d.freeAboveKobo,
      };
    } catch {
      // No zone covers this address; the bag simply shows no hint.
      return null;
    }
  }

  @Get('countries')
  @ApiOperation({ summary: 'Countries with an active delivery zone' })
  countries() {
    return this.delivery.shippingCountries();
  }
}
