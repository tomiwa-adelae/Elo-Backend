import {
  Body,
  Controller,
  Global,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AvailabilityService } from '../inventory/availability.service';
import { Public } from '../decorators/public.decorator';

export class RestockAlertDto {
  @IsUUID('all', { message: 'Choose a size first' }) variantId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;
}

/**
 * "Email me when it's back". Shoppers sign up against a sold-out variant;
 * whenever stock goes up (an admin edit, a stock adjustment, a cancelled
 * order), waiting shoppers for variants that are now buyable get one email.
 */
@Injectable()
export class RestockService {
  private readonly logger = new Logger(RestockService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private availability: AvailabilityService,
  ) {}

  async request(dto: RestockAlertDto) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, isActive: true },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException('That option is no longer sold');

    // Signing up again re-arms an alert that already fired.
    await this.prisma.restockAlert.upsert({
      where: {
        variantId_email: { variantId: dto.variantId, email: dto.email },
      },
      create: { variantId: dto.variantId, email: dto.email },
      update: { notifiedAt: null },
    });
    return { subscribed: true };
  }

  /** How many shoppers are waiting on each variant, for the admin editor. */
  async waitingCounts(variantIds: string[]) {
    if (!variantIds.length) return new Map<string, number>();
    const rows = await this.prisma.restockAlert.groupBy({
      by: ['variantId'],
      where: { variantId: { in: variantIds }, notifiedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.variantId, r._count._all]));
  }

  /**
   * Fire-and-forget hook for anything that adds stock. Never throws: a mail
   * hiccup must not fail the admin's save.
   */
  notifyLater(variantIds?: string[]) {
    void this.notifyAvailable(variantIds).catch((error: unknown) =>
      this.logger.error(`Restock notifications failed: ${String(error)}`),
    );
  }

  /**
   * Safety net for stock that frees up without an admin action, such as an
   * abandoned checkout's hold expiring.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep() {
    await this.notifyAvailable().catch((error: unknown) =>
      this.logger.error(`Restock sweep failed: ${String(error)}`),
    );
  }

  async notifyAvailable(variantIds?: string[]) {
    const alerts = await this.prisma.restockAlert.findMany({
      where: {
        notifiedAt: null,
        ...(variantIds && { variantId: { in: variantIds } }),
      },
      select: {
        id: true,
        email: true,
        variant: {
          select: {
            id: true,
            stock: true,
            lowStockAt: true,
            allowBackorder: true,
            isActive: true,
            image: true,
            optionValues: {
              select: { value: true, option: { select: { name: true } } },
            },
            product: {
              select: {
                title: true,
                slug: true,
                status: true,
                images: {
                  orderBy: { position: 'asc' },
                  select: { url: true, colour: true },
                },
              },
            },
          },
        },
      },
    });
    if (!alerts.length) return 0;

    const variants = [
      ...new Map(alerts.map((a) => [a.variant.id, a.variant])).values(),
    ];
    const availability = await this.availability.resolve(variants);

    let sent = 0;
    for (const alert of alerts) {
      const v = alert.variant;
      const live =
        v.isActive &&
        v.product.status === 'ACTIVE' &&
        (availability.get(v.id)?.available ?? 0) > 0;
      if (!live) continue;

      const colour = v.optionValues.find((o) =>
        /colou?r/i.test(o.option.name),
      )?.value;
      const image =
        v.image ??
        (colour && v.product.images.find((i) => i.colour === colour)?.url) ??
        v.product.images[0]?.url ??
        null;

      // Claim the alert first so two overlapping runs can't both email.
      const claimed = await this.prisma.restockAlert.updateMany({
        where: { id: alert.id, notifiedAt: null },
        data: { notifiedAt: new Date() },
      });
      if (!claimed.count) continue;

      await this.mail.sendBackInStock(alert.email, {
        productTitle: v.product.title,
        productSlug: v.product.slug,
        variantLabel: v.optionValues.map((o) => o.value).join(' / '),
        colour,
        image,
      });
      sent++;
    }
    if (sent) this.logger.log(`Sent ${sent} back-in-stock email(s)`);
    return sent;
  }
}

@ApiTags('restock')
@Controller('restock-alerts')
export class RestockController {
  constructor(private restock: RestockService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Email me when this option is back in stock" })
  request(@Body() dto: RestockAlertDto) {
    return this.restock.request(dto);
  }
}

// Global so admin services can call notifyLater() without import churn.
@Global()
@Module({
  controllers: [RestockController],
  providers: [RestockService],
  exports: [RestockService],
})
export class RestockModule {}
