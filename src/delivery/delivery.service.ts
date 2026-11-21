import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolvedDelivery {
  zoneId: string;
  zoneName: string;
  feeKobo: number;
  /** True when the order qualified for the zone's free-delivery threshold. */
  isFree: boolean;
  freeAboveKobo: number | null;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  allowPayOnDelivery: boolean;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

@Injectable()
export class DeliveryService {
  constructor(private prisma: PrismaService) {}

  async listZones() {
    return this.prisma.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: { feeKobo: 'asc' },
      select: {
        id: true,
        name: true,
        states: true,
        cities: true,
        feeKobo: true,
        freeAboveKobo: true,
        estimatedMinDays: true,
        estimatedMaxDays: true,
        allowPayOnDelivery: true,
      },
    });
  }

  /**
   * Picks the zone covering an address.
   *
   * A zone listing cities is more specific than one covering a whole state,
   * so city matches win — that is what lets "Lagos Mainland" and "Lagos
   * Island" price differently while a state-wide "Lagos" zone catches
   * everywhere else.
   */
  async resolve(
    state: string,
    city: string,
    subtotalKobo: number,
  ): Promise<ResolvedDelivery> {
    const zones = await this.prisma.deliveryZone.findMany({
      where: { isActive: true },
    });

    const wantedState = normalise(state);
    const wantedCity = normalise(city);

    const inState = zones.filter((zone) =>
      zone.states.some((s) => normalise(s) === wantedState),
    );

    const cityMatch = inState.find((zone) =>
      zone.cities.some((c) => normalise(c) === wantedCity),
    );

    // Among state-wide zones, a zone with no city list is the catch-all.
    const stateMatch = inState.find((zone) => zone.cities.length === 0);

    const zone = cityMatch ?? stateMatch ?? inState[0];

    if (!zone) {
      throw new NotFoundException(
        `We do not currently deliver to ${state}. Please contact support.`,
      );
    }

    const isFree =
      zone.freeAboveKobo !== null && subtotalKobo >= zone.freeAboveKobo;

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      feeKobo: isFree ? 0 : zone.feeKobo,
      isFree,
      freeAboveKobo: zone.freeAboveKobo,
      estimatedMinDays: zone.estimatedMinDays,
      estimatedMaxDays: zone.estimatedMaxDays,
      allowPayOnDelivery: zone.allowPayOnDelivery,
    };
  }
}
