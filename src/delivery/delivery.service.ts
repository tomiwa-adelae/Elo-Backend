import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { fromKobo, type Currency } from '../money/money';
import type { DeliveryZone } from '../../generated/prisma/client';

export interface ResolvedDelivery {
  zoneId: string;
  zoneName: string;
  /** In the requested currency's minor unit. */
  feeKobo: number;
  /** True when the order qualified for the zone's free-delivery threshold. */
  isFree: boolean;
  freeAboveKobo: number | null;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  allowPayOnDelivery: boolean;
}

export interface DeliveryAddress {
  countryCode?: string;
  state: string;
  city: string;
}

const REST_OF_WORLD = '*';

function normalise(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

@Injectable()
export class DeliveryService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  /** Public zone list, priced in `currency`. */
  async listZones(currency: Currency = 'NGN') {
    const [zones, store] = await Promise.all([
      this.prisma.deliveryZone.findMany({
        where: { isActive: true },
        orderBy: [{ position: 'asc' }, { feeKobo: 'asc' }],
      }),
      this.settings.get(),
    ]);

    return zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      countries: zone.countries,
      states: zone.states,
      cities: zone.cities,
      currency,
      ...this.price(zone, currency, store.ngnPerUsd),
      estimatedMinDays: zone.estimatedMinDays,
      estimatedMaxDays: zone.estimatedMaxDays,
      allowPayOnDelivery: zone.allowPayOnDelivery,
    }));
  }

  /** Countries ELO ships to, for the checkout country picker. */
  async shippingCountries() {
    const zones = await this.prisma.deliveryZone.findMany({
      where: { isActive: true },
      select: { countries: true },
    });
    const codes = new Set(zones.flatMap((z) => z.countries));
    return {
      worldwide: codes.has(REST_OF_WORLD),
      countries: [...codes].filter((c) => c !== REST_OF_WORLD).sort(),
    };
  }

  private price(zone: DeliveryZone, currency: Currency, rate: number) {
    if (currency === 'USD') {
      return {
        feeKobo: zone.feeUsdCents ?? fromKobo(zone.feeKobo, currency, rate),
        freeAboveKobo:
          zone.freeAboveUsdCents ??
          fromKobo(zone.freeAboveKobo, currency, rate),
      };
    }
    return { feeKobo: zone.feeKobo, freeAboveKobo: zone.freeAboveKobo };
  }

  /**
   * Picks the zone covering an address.
   *
   * Nigeria: a zone listing cities is more specific than one covering a whole
   * state, so city matches win — that is what lets "Lagos Mainland" and
   * "Lagos Island" price differently while a state-wide zone catches the rest.
   *
   * Elsewhere: the zone naming the country wins over the "*" catch-all.
   */
  async resolve(
    address: DeliveryAddress,
    subtotal: number,
    currency: Currency = 'NGN',
  ): Promise<ResolvedDelivery> {
    const [zones, store] = await Promise.all([
      this.prisma.deliveryZone.findMany({ where: { isActive: true } }),
      this.settings.get(),
    ]);

    const country = (address.countryCode || 'NG').toUpperCase();
    const zone =
      country === 'NG'
        ? this.matchNigeria(zones, address)
        : (zones.find((z) => z.countries.includes(country)) ??
          zones.find((z) => z.countries.includes(REST_OF_WORLD)));

    if (!zone) {
      throw new NotFoundException(
        country === 'NG'
          ? `We do not currently deliver to ${address.state}. Please message us on WhatsApp.`
          : 'We do not currently ship to that country. Please message us on WhatsApp.',
      );
    }

    const { feeKobo, freeAboveKobo } = this.price(
      zone,
      currency,
      store.ngnPerUsd,
    );
    const isFree = freeAboveKobo !== null && subtotal >= freeAboveKobo;

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      feeKobo: isFree ? 0 : feeKobo,
      isFree,
      freeAboveKobo,
      estimatedMinDays: zone.estimatedMinDays,
      estimatedMaxDays: zone.estimatedMaxDays,
      // Cash on delivery only works for naira orders inside Nigeria.
      allowPayOnDelivery:
        zone.allowPayOnDelivery && country === 'NG' && currency === 'NGN',
    };
  }

  private matchNigeria(zones: DeliveryZone[], address: DeliveryAddress) {
    const wantedState = normalise(address.state);
    const wantedCity = normalise(address.city);

    const inState = zones.filter(
      (zone) =>
        zone.countries.includes('NG') &&
        zone.states.some((s) => normalise(s) === wantedState),
    );

    const cityMatch = inState.find((zone) =>
      zone.cities.some((c) => normalise(c) === wantedCity),
    );

    // Among state-wide zones, a zone with no city list is the catch-all.
    const stateMatch = inState.find((zone) => zone.cities.length === 0);

    return cityMatch ?? stateMatch ?? inState[0];
  }
}
