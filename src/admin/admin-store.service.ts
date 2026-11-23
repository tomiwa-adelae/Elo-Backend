import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';
import type {
  PageQueryDto,
  SaveCategoryDto,
  SaveCollectionDto,
  SaveDeliveryZoneDto,
  SaveDiscountDto,
} from './dto/store.dto';

const toSlug = (value: string) =>
  slugify(value, { lower: true, strict: true, trim: true }) || 'item';

/** Categories, collections, delivery zones, discounts and customers. */
@Injectable()
export class AdminStoreService {
  constructor(private prisma: PrismaService) {}

  private async freeSlug(
    model: 'category' | 'collection',
    name: string,
    selfId?: string,
  ) {
    const base = toSlug(name);
    let candidate = base;
    for (let n = 2; n < 200; n++) {
      const where = { slug: candidate, ...(selfId && { id: { not: selfId } }) };
      const clash =
        model === 'category'
          ? await this.prisma.category.findFirst({
              where,
              select: { id: true },
            })
          : await this.prisma.collection.findFirst({
              where,
              select: { id: true },
            });
      if (!clash) return candidate;
      candidate = `${base}-${n}`;
    }
    throw new BadRequestException('Could not find a free URL for this name');
  }

  // ── categories ───────────────────────────────────────────────────────────

  async listCategories() {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });
    return categories.map(({ _count, ...c }) => ({
      ...c,
      productCount: _count.products,
    }));
  }

  async createCategory(dto: SaveCategoryDto) {
    return this.prisma.category.create({
      data: {
        name: dto.name,
        slug: await this.freeSlug('category', dto.name),
        parentId: dto.parentId || null,
        image: dto.image || null,
        position: dto.position ?? 0,
      },
    });
  }

  async updateCategory(id: string, dto: SaveCategoryDto) {
    if (dto.parentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }
    await this.mustExist(this.prisma.category.findUnique({ where: { id } }));
    return this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug: await this.freeSlug('category', dto.name, id),
        parentId: dto.parentId || null,
        image: dto.image || null,
        position: dto.position ?? 0,
      },
    });
  }

  async deleteCategory(id: string) {
    const children = await this.prisma.category.count({
      where: { parentId: id },
    });
    if (children) {
      throw new ConflictException(
        'Move or delete the sub-categories inside this category first',
      );
    }
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      }),
      this.prisma.category.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  // ── collections ──────────────────────────────────────────────────────────

  async listCollections() {
    const collections = await this.prisma.collection.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return collections.map(({ _count, ...c }) => ({
      ...c,
      productCount: _count.products,
    }));
  }

  async createCollection(dto: SaveCollectionDto) {
    return this.prisma.collection.create({
      data: {
        name: dto.name,
        slug: await this.freeSlug('collection', dto.name),
        description: dto.description || null,
        image: dto.image || null,
        isActive: dto.isActive ?? true,
        position: dto.position ?? 0,
      },
    });
  }

  async updateCollection(id: string, dto: SaveCollectionDto) {
    await this.mustExist(this.prisma.collection.findUnique({ where: { id } }));
    return this.prisma.collection.update({
      where: { id },
      data: {
        name: dto.name,
        slug: await this.freeSlug('collection', dto.name, id),
        description: dto.description || null,
        image: dto.image || null,
        isActive: dto.isActive ?? true,
        position: dto.position ?? 0,
      },
    });
  }

  async deleteCollection(id: string) {
    await this.mustExist(this.prisma.collection.findUnique({ where: { id } }));
    await this.prisma.collection.delete({ where: { id } });
    return { deleted: true };
  }

  // ── delivery zones ───────────────────────────────────────────────────────

  listZones() {
    return this.prisma.deliveryZone.findMany({
      orderBy: [{ position: 'asc' }, { feeKobo: 'asc' }],
    });
  }

  private zoneData(dto: SaveDeliveryZoneDto) {
    if (dto.estimatedMaxDays < dto.estimatedMinDays) {
      throw new BadRequestException(
        'The latest delivery day cannot be before the earliest',
      );
    }
    const clean = (list: string[]) => [
      ...new Set(list.map((s) => s.trim()).filter(Boolean)),
    ];
    const countries = clean(dto.countries ?? ['NG']).map((c) =>
      c.toUpperCase(),
    );
    if (!countries.length) {
      throw new BadRequestException('A zone must cover at least one country');
    }
    const states = countries.includes('NG') ? clean(dto.states) : [];
    if (countries.includes('NG') && !states.length) {
      throw new BadRequestException(
        'A Nigerian zone must cover at least one state',
      );
    }
    return {
      name: dto.name,
      countries,
      states,
      cities: clean(dto.cities ?? []),
      feeKobo: dto.feeKobo,
      freeAboveKobo: dto.freeAboveKobo || null,
      feeUsdCents: dto.feeUsdCents ?? null,
      freeAboveUsdCents: dto.freeAboveUsdCents || null,
      position: dto.position ?? 0,
      estimatedMinDays: dto.estimatedMinDays,
      estimatedMaxDays: dto.estimatedMaxDays,
      // Cash on delivery is only collected by Nigerian riders.
      allowPayOnDelivery: dto.allowPayOnDelivery && countries.includes('NG'),
      isActive: dto.isActive,
    };
  }

  createZone(dto: SaveDeliveryZoneDto) {
    return this.prisma.deliveryZone.create({ data: this.zoneData(dto) });
  }

  async updateZone(id: string, dto: SaveDeliveryZoneDto) {
    await this.mustExist(
      this.prisma.deliveryZone.findUnique({ where: { id } }),
    );
    return this.prisma.deliveryZone.update({
      where: { id },
      data: this.zoneData(dto),
    });
  }

  async deleteZone(id: string) {
    await this.mustExist(
      this.prisma.deliveryZone.findUnique({ where: { id } }),
    );
    const used = await this.prisma.shipment.count({ where: { zoneId: id } });
    if (used) {
      // Past shipments reference it; switch it off instead of deleting.
      await this.prisma.deliveryZone.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.deliveryZone.delete({ where: { id } });
    return { deleted: true };
  }

  // ── discounts ────────────────────────────────────────────────────────────

  listDiscounts() {
    return this.prisma.discount.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private discountData(dto: SaveDiscountDto) {
    if (dto.type === 'PERCENTAGE' && (dto.value < 1 || dto.value > 100)) {
      throw new BadRequestException('A percentage discount must be 1–100');
    }
    if (dto.type === 'FIXED_AMOUNT' && dto.value < 100) {
      throw new BadRequestException('A fixed discount must be at least ₦1');
    }
    if (
      dto.endsAt &&
      dto.startsAt &&
      new Date(dto.endsAt) <= new Date(dto.startsAt)
    ) {
      throw new BadRequestException(
        'The end date must be after the start date',
      );
    }
    return {
      code: dto.code,
      type: dto.type,
      value: dto.type === 'FREE_SHIPPING' ? 0 : dto.value,
      maxDiscountKobo: dto.maxDiscountKobo || null,
      minSubtotalKobo: dto.minSubtotalKobo || null,
      appliesToCollectionIds: dto.appliesToCollectionIds ?? [],
      appliesToProductIds: dto.appliesToProductIds ?? [],
      usageLimit: dto.usageLimit || null,
      perUserLimit: dto.perUserLimit || null,
      ...(dto.startsAt && { startsAt: new Date(dto.startsAt) }),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      isActive: dto.isActive,
    };
  }

  private async assertCodeFree(code: string, selfId?: string) {
    const clash = await this.prisma.discount.findFirst({
      where: { code, ...(selfId && { id: { not: selfId } }) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`The code ${code} already exists`);
  }

  async createDiscount(dto: SaveDiscountDto) {
    await this.assertCodeFree(dto.code);
    return this.prisma.discount.create({ data: this.discountData(dto) });
  }

  async updateDiscount(id: string, dto: SaveDiscountDto) {
    await this.mustExist(this.prisma.discount.findUnique({ where: { id } }));
    await this.assertCodeFree(dto.code, id);
    return this.prisma.discount.update({
      where: { id },
      data: this.discountData(dto),
    });
  }

  async deleteDiscount(id: string) {
    await this.mustExist(this.prisma.discount.findUnique({ where: { id } }));
    const used = await this.prisma.order.count({ where: { discountId: id } });
    if (used) {
      await this.prisma.discount.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: false, deactivated: true };
    }
    await this.prisma.$transaction([
      this.prisma.cart.updateMany({
        where: { discountId: id },
        data: { discountId: null },
      }),
      this.prisma.discount.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  // ── customers ────────────────────────────────────────────────────────────

  async listCustomers(query: PageQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const where = {
      role: 'CUSTOMER' as const,
      isDeleted: false,
      ...(query.search && {
        OR: [
          { email: { contains: query.search, mode: 'insensitive' as const } },
          {
            firstName: { contains: query.search, mode: 'insensitive' as const },
          },
          {
            lastName: { contains: query.search, mode: 'insensitive' as const },
          },
          { phoneNumber: { contains: query.search } },
        ],
      }),
    };

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          createdAt: true,
          acceptsMarketing: true,
        },
      }),
    ]);

    const spend = await this.prisma.order.groupBy({
      by: ['userId'],
      where: {
        userId: { in: users.map((u) => u.id) },
        paymentStatus: 'PAID',
      },
      _sum: { totalNgnKobo: true },
      _count: { _all: true },
    });
    const byUser = new Map(spend.map((s) => [s.userId, s]));

    return {
      items: users.map((u) => ({
        ...u,
        paidOrders: byUser.get(u.id)?._count._all ?? 0,
        totalSpentKobo: byUser.get(u.id)?._sum.totalNgnKobo ?? 0,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
      },
    };
  }

  private async mustExist<T>(lookup: Promise<T | null>): Promise<T> {
    const found = await lookup;
    if (!found) throw new NotFoundException('Not found');
    return found;
  }
}
