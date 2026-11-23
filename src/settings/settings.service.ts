import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { setMailBrand } from '../mail/templates';
import { usdRange } from '../money/money';
import type { Prisma, StoreSettings } from '../../generated/prisma/client';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

const SETTINGS_ID = 'store';

// Neutral defaults so a fresh deployment renders sensibly before anyone
// touches the settings page.
export const DEFAULT_THEME = {
  primary: '#2B2A26',
  primaryForeground: '#F7F4EF',
  background: '#F7F4EF',
  foreground: '#2B2A26',
  muted: '#ECE7DF',
  accent: '#8C8A3A',
  fontHeading: 'Cormorant Garamond',
  fontBody: 'Outfit',
  radius: '0.75rem',
};

/**
 * Store settings are read on nearly every storefront request (layout, emails,
 * checkout rules) and written almost never, so they are cached in memory and
 * the cache is replaced on write. One process per store makes this safe.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: StoreSettings | null = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.get();
    } catch {
      // A cold database must not stop the API booting; the first request
      // will load settings instead.
    }
  }

  async get(): Promise<StoreSettings> {
    if (this.cache) return this.cache;

    const settings = await this.prisma.storeSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: {
        id: SETTINGS_ID,
        name: process.env.STORE_NAME ?? 'ELO',
        theme: DEFAULT_THEME,
      },
    });

    return this.remember(settings);
  }

  /** The storefront-safe view, with theme defaults filled in. */
  async getPublic() {
    const { updatedAt, ...settings } = await this.get();
    return {
      ...settings,
      theme: { ...DEFAULT_THEME, ...((settings.theme as object) ?? {}) },
      updatedAt,
    };
  }

  async update(dto: UpdateSettingsDto) {
    const current = await this.get();
    const { theme, ...rest } = dto;

    // Empty strings from the admin form mean "clear this field".
    const data: Prisma.StoreSettingsUpdateInput = Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        typeof value === 'string' && value.trim() === '' && key !== 'name'
          ? null
          : value,
      ]),
    );

    if (theme) {
      data.theme = { ...((current.theme as object) ?? {}), ...theme };
    }

    const settings = await this.prisma.storeSettings.update({
      where: { id: SETTINGS_ID },
      data,
    });

    this.remember(settings);

    if (dto.ngnPerUsd !== undefined && dto.ngnPerUsd !== current.ngnPerUsd) {
      await this.repriceUsd(settings.ngnPerUsd);
    }

    return this.getPublic();
  }

  /**
   * Converted dollar prices depend on the rate, so the denormalised product
   * ranges used for listing and sorting are refreshed when it changes.
   */
  private async repriceUsd(ngnPerUsd: number) {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        variants: {
          select: { priceKobo: true, priceUsdCents: true, isActive: true },
        },
      },
    });
    await this.prisma.$transaction(
      products.map((p) =>
        this.prisma.product.update({
          where: { id: p.id },
          data: usdRange(p.variants, ngnPerUsd),
        }),
      ),
    );
  }

  private remember(settings: StoreSettings) {
    this.cache = settings;
    setMailBrand(settings.name);
    return settings;
  }
}
