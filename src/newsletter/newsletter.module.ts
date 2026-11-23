import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import { PageQueryDto } from '../admin/dto/store.dto';

export class SubscribeDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @IsOptional() @IsString() @MaxLength(40) source?: string;
}

@Injectable()
export class NewsletterService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  /**
   * Idempotent: subscribing twice is a no-op, and re-subscribing after an
   * unsubscribe reactivates without a second welcome email.
   */
  async subscribe(dto: SubscribeDto) {
    const existing = await this.prisma.subscriber.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      if (existing.unsubscribedAt) {
        await this.prisma.subscriber.update({
          where: { id: existing.id },
          data: { unsubscribedAt: null },
        });
      }
      return { subscribed: true };
    }

    await this.prisma.subscriber.create({
      data: { email: dto.email, source: dto.source ?? 'footer' },
    });
    await this.mail.sendSubscriberWelcome(dto.email);

    return { subscribed: true };
  }

  async list(query: PageQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      unsubscribedAt: null,
      ...(query.search && {
        email: { contains: query.search, mode: 'insensitive' as const },
      }),
    };
    const [total, items] = await Promise.all([
      this.prisma.subscriber.count({ where }),
      this.prisma.subscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
      },
    };
  }
}

@ApiTags('newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Join the mailing list' })
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletter.subscribe(dto);
  }

  @Get('subscribers')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Active subscribers (admin)' })
  list(@Query() query: PageQueryDto) {
    return this.newsletter.list(query);
  }
}

@Module({
  controllers: [NewsletterController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
