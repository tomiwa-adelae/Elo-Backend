import { Global, Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { ReservationService } from './reservation.service';

// Global: catalog, cart and checkout all need the same stock arithmetic.
@Global()
@Module({
  providers: [AvailabilityService, ReservationService],
  exports: [AvailabilityService, ReservationService],
})
export class InventoryModule {}
