import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import slugify from 'slugify';
import { PrismaService } from '../prisma/prisma.service';
import { RestockService } from '../restock/restock.module';
import { AvailabilityService } from '../inventory/availability.service';
import { SettingsService } from '../settings/settings.service';
import { usdRange } from '../money/money';
import type { Prisma } from '../../generated/prisma/client';
import type {
  AdjustStockDto,
  AdminProductQueryDto,
  SaveProductDto,
} from './dto/product.dto';

type Tx = Prisma.TransactionClient;

const toSlug = (value: string) =>
  slugify(value, { lower: true, strict: true, trim: true }) || 'product';

const skuPart = (value: string) =>
  slugify(value, { strict: true, trim: true }).toUpperCase().slice(0, 12) ||
  'X';

const blank = (value?: string | null) =>
  value === undefined ? undefined : value?.trim() ? value.trim() : null;

@Injectable()
export class AdminProductsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private availability: AvailabilityService,
    private restock: RestockService,
  ) {}

  // ── reads ────────────────────────────────────────────────────────────────

  async list(query: AdminProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.status && { status: query.status }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          {
            variants: {
              some: { sku: { contains: query.search, mode: 'insensitive' } },
            },
          },
        ],
      }),
    };

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        images: { orderBy: { position: 'asc' }, take: 1 },
        category: { select: { id: true, name: true } },
        variants: {
          where: { isActive: true },
          select: { id: true, stock: true, lowStockAt: true },
        },
      },
    });

    const rows = products.map((product) => {
      const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
      const lowStockVariants = product.variants.filter(
        (v) => v.stock <= v.lowStockAt,
      ).length;
      return {
        id: product.id,
        title: product.title,
        slug: product.slug,
        status: product.status,
        image: product.images[0]?.url ?? null,
        category: product.category,
        minPriceKobo: product.minPriceKobo,
        maxPriceKobo: product.maxPriceKobo,
        variantCount: product.variants.length,
        totalStock,
        lowStockVariants,
        updatedAt: product.updatedAt,
      };
    });

    // Low-stock is computed per variant, so it is filtered after the query.
    const filtered = query.lowStock
      ? rows.filter((row) => row.lowStockVariants > 0)
      : rows;

    const total = filtered.length;
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: page * limit < total,
      },
    };
  }

  async get(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        images: { orderBy: { position: 'asc' } },
        collections: { select: { collectionId: true } },
        options: {
          orderBy: { position: 'asc' },
          include: { values: { orderBy: { position: 'asc' } } },
        },
        variants: {
          orderBy: { createdAt: 'asc' },
          include: {
            optionValues: {
              select: { value: true, option: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!product) throw new NotFoundException('Product not found');

    const [availability, waiting] = await Promise.all([
      this.availability.resolve(product.variants),
      this.restock.waitingCounts(product.variants.map((v) => v.id)),
    ]);

    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      categoryId: product.categoryId,
      status: product.status,
      brand: product.brand,
      material: product.material,
      careNotes: product.careNotes,
      fitNotes: product.fitNotes,
      tags: product.tags,
      publishedAt: product.publishedAt,
      collectionIds: product.collections.map((c) => c.collectionId),
      images: product.images.map((i) => ({
        url: i.url,
        alt: i.alt,
        colour: i.colour,
      })),
      options: product.options.map((o) => ({
        name: o.name,
        values: o.values.map((v) => ({ value: v.value, swatch: v.swatch })),
      })),
      variants: product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        options: Object.fromEntries(
          v.optionValues.map((ov) => [ov.option.name, ov.value]),
        ),
        priceKobo: v.priceKobo,
        compareAtPriceKobo: v.compareAtPriceKobo,
        costKobo: v.costKobo,
        priceUsdCents: v.priceUsdCents,
        compareAtUsdCents: v.compareAtUsdCents,
        stock: v.stock,
        // Held by unpaid checkouts right now.
        reserved: availability.get(v.id)?.reserved ?? 0,
        // Shoppers who asked to be emailed when it's back.
        waiting: waiting.get(v.id) ?? 0,
        allowBackorder: v.allowBackorder,
        lowStockAt: v.lowStockAt,
        isActive: v.isActive,
        image: v.image,
      })),
    };
  }

  // ── writes ───────────────────────────────────────────────────────────────

  async create(dto: SaveProductDto, actorId?: string) {
    this.validateMatrix(dto);
    const id = await this.prisma.$transaction(
      (tx) => this.persist(tx, null, dto, actorId),
      { timeout: 60_000, maxWait: 15_000 },
    );
    this.restock.notifyLater();
    return this.get(id);
  }

  async update(id: string, dto: SaveProductDto, actorId?: string) {
    this.validateMatrix(dto);
    const exists = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Product not found');

    await this.prisma.$transaction((tx) => this.persist(tx, id, dto, actorId), {
      timeout: 60_000,
      maxWait: 15_000,
    });
    // Stock may have gone up; tell anyone waiting on these variants.
    this.restock.notifyLater();
    return this.get(id);
  }

  /** Soft delete: orders keep pointing at the variants they sold. */
  async remove(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, slug: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'ARCHIVED',
        // Frees the slug for a future product with the same name.
        slug: `${product.slug}-deleted-${Date.now()}`,
      },
    });
    return { deleted: true };
  }

  async adjustStock(variantId: string, dto: AdjustStockDto, actorId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true },
      });
      if (!variant) throw new NotFoundException('Variant not found');

      const delta = dto.stock - variant.stock;
      if (delta === 0) return { stock: variant.stock };

      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: dto.stock },
      });
      await tx.inventoryMovement.create({
        data: {
          variantId,
          delta,
          reason: dto.reason ?? (delta > 0 ? 'RESTOCK' : 'MANUAL_ADJUSTMENT'),
          resultingStock: dto.stock,
          note: dto.note,
          actorId,
        },
      });
      return { stock: dto.stock };
    });
    this.restock.notifyLater([variantId]);
    return result;
  }

  async stockHistory(variantId: string) {
    return this.prisma.inventoryMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Rejects a variant matrix that does not line up with the options before
   * anything is written: unknown option names, values that are not listed,
   * missing axes, or two variants claiming the same combination.
   */
  private validateMatrix(dto: SaveProductDto) {
    const names = dto.options.map((o) => o.name);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      throw new BadRequestException('Option names must be unique');
    }

    for (const option of dto.options) {
      const values = option.values.map((v) => v.value.toLowerCase());
      if (new Set(values).size !== values.length) {
        throw new BadRequestException(
          `"${option.name}" has the same value listed twice`,
        );
      }
    }

    if (dto.options.length === 0 && dto.variants.length !== 1) {
      throw new BadRequestException(
        'A product without options must have exactly one variant',
      );
    }

    const seen = new Set<string>();
    for (const variant of dto.variants) {
      const keys = Object.keys(variant.options ?? {});
      if (
        keys.length !== names.length ||
        !names.every((name) => keys.includes(name))
      ) {
        throw new BadRequestException(
          `Every variant must pick exactly one value for: ${names.join(', ') || 'no options'}`,
        );
      }
      for (const option of dto.options) {
        const picked = variant.options[option.name];
        if (!option.values.some((v) => v.value === picked)) {
          throw new BadRequestException(
            `"${picked}" is not a listed value of "${option.name}"`,
          );
        }
      }
      const signature = names.map((n) => variant.options[n]).join('\u0000');
      if (seen.has(signature)) {
        throw new BadRequestException(
          `Two variants share the combination ${names.map((n) => variant.options[n]).join(' / ')}`,
        );
      }
      seen.add(signature);

      if (
        variant.compareAtPriceKobo != null &&
        variant.compareAtPriceKobo > 0 &&
        variant.compareAtPriceKobo <= variant.priceKobo
      ) {
        throw new BadRequestException(
          'The "compare at" price must be higher than the selling price',
        );
      }
    }

    const skus = dto.variants
      .map((v) => v.sku?.trim().toUpperCase())
      .filter(Boolean);
    if (new Set(skus).size !== skus.length) {
      throw new BadRequestException('Two variants share the same SKU');
    }
  }

  private async uniqueSlug(tx: Tx, base: string, selfId: string | null) {
    let candidate = base;
    for (let n = 2; n < 500; n++) {
      const clash = await tx.product.findFirst({
        where: { slug: candidate, ...(selfId && { id: { not: selfId } }) },
        select: { id: true },
      });
      if (!clash) return candidate;
      candidate = `${base}-${n}`;
    }
    throw new BadRequestException('Could not find a free URL for this product');
  }

  private async persist(
    tx: Tx,
    id: string | null,
    dto: SaveProductDto,
    actorId?: string,
  ): Promise<string> {
    const slug = await this.uniqueSlug(tx, toSlug(dto.slug || dto.title), id);

    const existing = id
      ? await tx.product.findUnique({
          where: { id },
          select: { publishedAt: true },
        })
      : null;

    const prices = dto.variants
      .filter((v) => v.isActive ?? true)
      .map((v) => v.priceKobo);

    const { ngnPerUsd } = await this.settings.get();

    const base = {
      title: dto.title,
      minPriceKobo: prices.length ? Math.min(...prices) : 0,
      maxPriceKobo: prices.length ? Math.max(...prices) : 0,
      ...usdRange(
        dto.variants.map((v) => ({
          priceKobo: v.priceKobo,
          priceUsdCents: v.priceUsdCents ?? null,
          isActive: v.isActive,
        })),
        ngnPerUsd,
      ),
      slug,
      description: blank(dto.description),
      categoryId: dto.categoryId || null,
      status: dto.status,
      brand: blank(dto.brand),
      material: blank(dto.material),
      careNotes: blank(dto.careNotes),
      fitNotes: blank(dto.fitNotes),
      tags: [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))],
      publishedAt:
        dto.status === 'ACTIVE'
          ? (existing?.publishedAt ?? new Date())
          : (existing?.publishedAt ?? null),
    };

    const productId = id
      ? (await tx.product.update({ where: { id }, data: base })).id
      : (await tx.product.create({ data: base })).id;

    // Everything below diffs against the current rows and writes only what
    // changed: each query is a network round trip inside the transaction,
    // and a naive rewrite of a 40-variant product blows the timeout.
    const [currentOptions, current, currentImages, currentCollections] = id
      ? await Promise.all([
          tx.productOption.findMany({
            where: { productId },
            include: { values: true },
          }),
          tx.productVariant.findMany({
            where: { productId },
            include: { optionValues: { select: { id: true } } },
          }),
          tx.productImage.findMany({
            where: { productId },
            orderBy: { position: 'asc' },
          }),
          tx.productCollection.findMany({ where: { productId } }),
        ])
      : [[], [], [], []];

    // Options and their values, keyed by name so the matrix can resolve ids.
    const valueIds = new Map<string, Map<string, string>>();
    const optionByName = new Map(currentOptions.map((o) => [o.name, o]));

    for (const [i, option] of dto.options.entries()) {
      const existingOption = optionByName.get(option.name);

      if (!existingOption) {
        const created = await tx.productOption.create({
          data: {
            productId,
            name: option.name,
            position: i,
            values: {
              create: option.values.map((value, j) => ({
                value: value.value,
                position: j,
                swatch: value.swatch || null,
              })),
            },
          },
          include: { values: true },
        });
        valueIds.set(
          option.name,
          new Map(created.values.map((v) => [v.value, v.id])),
        );
        continue;
      }

      if (existingOption.position !== i) {
        await tx.productOption.update({
          where: { id: existingOption.id },
          data: { position: i },
        });
      }

      const ids = new Map<string, string>();
      const valueByName = new Map(
        existingOption.values.map((v) => [v.value, v]),
      );
      const toCreate: {
        value: string;
        position: number;
        swatch: string | null;
      }[] = [];

      for (const [j, value] of option.values.entries()) {
        const swatch = value.swatch || null;
        const found = valueByName.get(value.value);
        if (!found) {
          toCreate.push({ value: value.value, position: j, swatch });
          continue;
        }
        ids.set(value.value, found.id);
        if (found.position !== j || found.swatch !== swatch) {
          await tx.productOptionValue.update({
            where: { id: found.id },
            data: { position: j, swatch },
          });
        }
      }

      if (toCreate.length) {
        const created = await tx.productOptionValue.createManyAndReturn({
          data: toCreate.map((v) => ({ ...v, optionId: existingOption.id })),
          select: { id: true, value: true },
        });
        for (const v of created) ids.set(v.value, v.id);
      }

      const wanted = new Set(option.values.map((v) => v.value));
      const removed = existingOption.values.filter((v) => !wanted.has(v.value));
      if (removed.length) {
        await tx.productOptionValue.deleteMany({
          where: { id: { in: removed.map((v) => v.id) } },
        });
      }
      valueIds.set(option.name, ids);
    }

    const wantedOptions = new Set(dto.options.map((o) => o.name));
    const droppedOptions = currentOptions.filter(
      (o) => !wantedOptions.has(o.name),
    );
    if (droppedOptions.length) {
      await tx.productOption.deleteMany({
        where: { id: { in: droppedOptions.map((o) => o.id) } },
      });
    }

    // Variants: match by id first, then by option combination, else create.
    const signatureOf = (ids: string[]) => [...ids].sort().join('|');
    const bySignature = new Map(
      current.map((v) => [signatureOf(v.optionValues.map((o) => o.id)), v]),
    );
    const byId = new Map(current.map((v) => [v.id, v]));
    const kept = new Set<string>();
    const movements: Prisma.InventoryMovementCreateManyInput[] = [];
    const pending: {
      variant: SaveProductDto['variants'][number];
      ids: string[];
      requestedSku: string | undefined;
      fields: {
        priceKobo: number;
        compareAtPriceKobo: number | null;
        costKobo: number | null;
        priceUsdCents: number | null;
        compareAtUsdCents: number | null;
        allowBackorder: boolean;
        lowStockAt: number;
        isActive: boolean;
        image: string | null;
      };
    }[] = [];

    // One lookup for every SKU the admin typed, instead of one per row.
    const requestedSkus = dto.variants
      .map((v) => v.sku?.trim().toUpperCase())
      .filter((sku): sku is string => !!sku);
    const skuOwners = new Map(
      requestedSkus.length
        ? (
            await tx.productVariant.findMany({
              where: { sku: { in: requestedSkus } },
              select: { id: true, sku: true },
            })
          ).map((v) => [v.sku, v.id])
        : [],
    );

    for (const variant of dto.variants) {
      const ids = dto.options.map((o) =>
        valueIds.get(o.name)!.get(variant.options[o.name])!,
      );
      const match =
        (variant.id && byId.get(variant.id)) ||
        bySignature.get(signatureOf(ids));

      const requestedSku = variant.sku?.trim().toUpperCase();
      if (requestedSku) {
        const owner = skuOwners.get(requestedSku);
        if (owner && owner !== match?.id) {
          throw new BadRequestException(
            `SKU ${requestedSku} is already used by another product`,
          );
        }
      }

      const fields = {
        priceKobo: variant.priceKobo,
        compareAtPriceKobo: variant.compareAtPriceKobo || null,
        costKobo: variant.costKobo ?? null,
        priceUsdCents: variant.priceUsdCents || null,
        compareAtUsdCents: variant.compareAtUsdCents || null,
        allowBackorder: variant.allowBackorder ?? false,
        lowStockAt: variant.lowStockAt ?? 3,
        isActive: variant.isActive ?? true,
        image: variant.image || null,
      };

      if (match) {
        kept.add(match.id);
        const linksChanged =
          signatureOf(match.optionValues.map((o) => o.id)) !== signatureOf(ids);
        const changed =
          linksChanged ||
          match.stock !== variant.stock ||
          (requestedSku !== undefined && requestedSku !== match.sku) ||
          (Object.keys(fields) as (keyof typeof fields)[]).some(
            (key) => match[key] !== fields[key],
          );

        if (changed) {
          await tx.productVariant.update({
            where: { id: match.id },
            data: {
              ...fields,
              ...(requestedSku && { sku: requestedSku }),
              stock: variant.stock,
              ...(linksChanged && {
                optionValues: { set: ids.map((vid) => ({ id: vid })) },
              }),
            },
          });
        }
        const delta = variant.stock - match.stock;
        if (delta !== 0) {
          movements.push({
            variantId: match.id,
            delta,
            reason: delta > 0 ? 'RESTOCK' : 'MANUAL_ADJUSTMENT',
            resultingStock: variant.stock,
            note: 'Edited in product editor',
            actorId,
          });
        }
      } else {
        pending.push({ variant, ids, requestedSku, fields });
      }
    }

    // New variants go in as one batch: ids and SKUs are decided here, then a
    // single insert for the rows and one for their option links.
    if (pending.length) {
      const bases = pending.map(({ variant }) =>
        [
          skuPart(dto.title),
          ...dto.options.map((o) => skuPart(variant.options[o.name])),
        ].join('-'),
      );
      const taken = new Set(
        (
          await tx.productVariant.findMany({
            where: {
              OR: [...new Set(bases)].map((base) => ({
                sku: { startsWith: base },
              })),
            },
            select: { sku: true },
          })
        ).map((v) => v.sku),
      );
      for (const { requestedSku } of pending) {
        if (requestedSku) taken.add(requestedSku);
      }

      const rows = pending.map(({ variant, requestedSku, fields }, i) => {
        let sku = requestedSku;
        if (!sku) {
          sku = bases[i];
          for (let n = 2; taken.has(sku); n++) sku = `${bases[i]}-${n}`;
          taken.add(sku);
        }
        return {
          id: randomUUID(),
          productId,
          sku,
          stock: variant.stock,
          ...fields,
        };
      });

      await tx.productVariant.createMany({ data: rows });

      const links = rows.flatMap((row, i) =>
        pending[i].ids.map((valueId) => [valueId, row.id] as const),
      );
      if (links.length) {
        // Implicit many-to-many table: A = option value, B = variant.
        await tx.$executeRaw`
          INSERT INTO "_VariantOptionValues" ("A", "B")
          SELECT * FROM unnest(${links.map((l) => l[0])}::text[], ${links.map((l) => l[1])}::text[])`;
      }

      for (const row of rows) {
        kept.add(row.id);
        if (row.stock > 0) {
          movements.push({
            variantId: row.id,
            delta: row.stock,
            reason: 'RESTOCK',
            resultingStock: row.stock,
            note: 'Initial stock',
            actorId,
          });
        }
      }
    }

    if (movements.length) {
      await tx.inventoryMovement.createMany({ data: movements });
    }

    // Variants dropped from the editor are switched off, not deleted, so past
    // orders and stock history still resolve.
    const dropped = current.filter((v) => !kept.has(v.id) && v.isActive);
    if (dropped.length) {
      await tx.productVariant.updateMany({
        where: { id: { in: dropped.map((v) => v.id) } },
        data: { isActive: false },
      });
    }

    const imagesSame =
      currentImages.length === dto.images.length &&
      currentImages.every(
        (img, i) =>
          img.url === dto.images[i].url &&
          img.alt === (blank(dto.images[i].alt) ?? null) &&
          img.colour === (blank(dto.images[i].colour) ?? null),
      );
    if (!imagesSame) {
      await tx.productImage.deleteMany({ where: { productId } });
      if (dto.images.length) {
        await tx.productImage.createMany({
          data: dto.images.map((image, position) => ({
            productId,
            url: image.url,
            alt: blank(image.alt) ?? null,
            colour: blank(image.colour) ?? null,
            position,
          })),
        });
      }
    }

    const wantedCollections = [...new Set(dto.collectionIds)];
    const collectionsSame =
      currentCollections.length === wantedCollections.length &&
      currentCollections.every((c) =>
        wantedCollections.includes(c.collectionId),
      );
    if (!collectionsSame) {
      await tx.productCollection.deleteMany({ where: { productId } });
      if (wantedCollections.length) {
        await tx.productCollection.createMany({
          data: wantedCollections.map((collectionId) => ({
            productId,
            collectionId,
          })),
        });
      }
    }

    return productId;
  }
}
