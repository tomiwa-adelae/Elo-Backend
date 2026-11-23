import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../inventory/availability.service';
import { ProductQueryDto, ProductSort } from './dto/product-query.dto';
import type { Prisma } from '../../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { variantPrice } from '../money/money';

/**
 * Only ACTIVE, already-published, non-deleted products are visible on the
 * storefront. Built per call rather than hoisted to a const so `lte: now` is
 * evaluated at query time — a scheduled drop would otherwise stay hidden
 * until the process restarted.
 */
function visibleProducts(): Prisma.ProductWhereInput {
  return {
    status: 'ACTIVE',
    publishedAt: { not: null, lte: new Date() },
    deletedAt: null,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private availability: AvailabilityService,
    private settings: SettingsService,
  ) {}

  // ── listing ──────────────────────────────────────────────────────────────

  async listProducts(query: ProductQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 24;

    const where = await this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort);

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: { orderBy: { position: 'asc' } },
          category: { select: { id: true, name: true, slug: true } },
          variants: {
            where: { isActive: true },
            select: {
              id: true,
              stock: true,
              lowStockAt: true,
              allowBackorder: true,
              priceKobo: true,
              compareAtPriceKobo: true,
              optionValues: {
                select: {
                  value: true,
                  swatch: true,
                  option: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const availability = await this.availability.resolve(
      products.flatMap((p) => p.variants),
    );

    const items = products.map((product) => {
      const inStock = product.variants.some(
        (v) => availability.get(v.id)?.inStock ?? false,
      );

      const onSale = product.variants.some(
        (v) =>
          v.compareAtPriceKobo !== null && v.compareAtPriceKobo > v.priceKobo,
      );

      // Colour swatches shown on the listing card without loading the full
      // variant matrix.
      const swatches = this.collectSwatches(product.variants);

      return {
        id: product.id,
        slug: product.slug,
        title: product.title,
        brand: product.brand,
        category: product.category,
        minPriceKobo: product.minPriceKobo,
        maxPriceKobo: product.maxPriceKobo,
        minPriceUsdCents: product.minPriceUsdCents,
        maxPriceUsdCents: product.maxPriceUsdCents,
        images: product.images
          .slice(0, 2)
          .map((i) => ({ url: i.url, alt: i.alt })),
        // First photo of each colour, so cards can preview a swatch.
        colourImages: Object.fromEntries(
          product.images
            .filter((i): i is typeof i & { colour: string } => !!i.colour)
            .reverse()
            .map((i): [string, string] => [i.colour, i.url]),
        ),
        tags: product.tags,
        inStock,
        onSale,
        swatches,
        publishedAt: product.publishedAt,
      };
    });

    // in-stock filtering depends on reservations, which SQL does not know
    // about, so it is applied after resolution.
    const filtered = query.inStockOnly
      ? items.filter((item) => item.inStock)
      : items;

    return {
      items: filtered,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
    };
  }

  private collectSwatches(
    variants: {
      optionValues: {
        value: string;
        swatch: string | null;
        option: { name: string };
      }[];
    }[],
  ) {
    const seen = new Map<string, { value: string; swatch: string | null }>();

    for (const variant of variants) {
      for (const ov of variant.optionValues) {
        if (ov.swatch === null) continue;
        if (!seen.has(ov.value)) {
          seen.set(ov.value, { value: ov.value, swatch: ov.swatch });
        }
      }
    }

    return [...seen.values()];
  }

  private buildOrderBy(
    sort: ProductSort | undefined,
  ): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case ProductSort.PRICE_ASC:
        return { minPriceKobo: 'asc' };
      case ProductSort.PRICE_DESC:
        return { minPriceKobo: 'desc' };
      case ProductSort.NAME_ASC:
        return { title: 'asc' };
      case ProductSort.NEWEST:
      default:
        return { publishedAt: 'desc' };
    }
  }

  private async buildWhere(
    query: ProductQueryDto,
  ): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [visibleProducts()];

    if (query.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { brand: { contains: query.search, mode: 'insensitive' } },
          { tags: { has: query.search.toLowerCase() } },
        ],
      });
    }

    if (query.category) {
      // Category pages are expected to include everything beneath them, so a
      // request for "women" also returns "women > dresses".
      const ids = await this.descendantCategoryIds(query.category);
      and.push({ categoryId: { in: ids } });
    }

    if (query.collection) {
      and.push({
        collections: {
          some: { collection: { slug: query.collection, isActive: true } },
        },
      });
    }

    if (query.brand) and.push({ brand: query.brand });

    if (query.tags?.length) and.push({ tags: { hasSome: query.tags } });

    // Size and colour are separate ANDs: "size M" and "colour black" must mean
    // one variant that is both, not one variant in M plus another in black.
    for (const value of [query.size, query.colour]) {
      if (!value?.length) continue;
      and.push({
        variants: {
          some: {
            isActive: true,
            optionValues: { some: { value: { in: value } } },
          },
        },
      });
    }

    if (query.minPriceKobo !== undefined) {
      and.push({ maxPriceKobo: { gte: query.minPriceKobo } });
    }

    if (query.maxPriceKobo !== undefined) {
      and.push({ minPriceKobo: { lte: query.maxPriceKobo } });
    }

    if (query.onSale) {
      and.push({
        variants: {
          some: { isActive: true, compareAtPriceKobo: { not: null } },
        },
      });
    }

    return { AND: and };
  }

  /** A category slug plus every category nested underneath it. */
  private async descendantCategoryIds(slug: string): Promise<string[]> {
    const root = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!root) throw new NotFoundException(`Unknown category "${slug}"`);

    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });

    const childrenByParent = new Map<string, string[]>();
    for (const category of all) {
      if (!category.parentId) continue;
      const siblings = childrenByParent.get(category.parentId) ?? [];
      siblings.push(category.id);
      childrenByParent.set(category.parentId, siblings);
    }

    const ids: string[] = [];
    const queue = [root.id];

    while (queue.length) {
      const current = queue.shift()!;
      ids.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }

    return ids;
  }

  // ── detail ───────────────────────────────────────────────────────────────

  async getProductBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, ...visibleProducts() },
      include: {
        images: { orderBy: { position: 'asc' } },
        category: {
          select: { id: true, name: true, slug: true, sizeGuide: true },
        },
        collections: {
          include: {
            collection: { select: { id: true, name: true, slug: true } },
          },
        },
        options: {
          orderBy: { position: 'asc' },
          include: { values: { orderBy: { position: 'asc' } } },
        },
        variants: {
          where: { isActive: true },
          include: {
            optionValues: {
              select: {
                id: true,
                value: true,
                swatch: true,
                option: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!product) throw new NotFoundException('Product not found');

    const availability = await this.availability.resolve(product.variants);
    const { ngnPerUsd } = await this.settings.get();

    const variants = product.variants.map((variant) => {
      const stock = availability.get(variant.id);
      const usd = variantPrice(variant, 'USD', ngnPerUsd);

      return {
        id: variant.id,
        sku: variant.sku,
        priceKobo: variant.priceKobo,
        compareAtPriceKobo: variant.compareAtPriceKobo,
        // Effective dollar prices (explicit or converted).
        priceUsdCents: usd.price,
        compareAtUsdCents: usd.compareAt,
        image: variant.image,
        // The option combination this SKU represents, e.g. { Size: 'M',
        // Colour: 'Black' } — this is what the picker matches against.
        options: Object.fromEntries(
          variant.optionValues.map((ov) => [ov.option.name, ov.value]),
        ),
        inStock: stock?.inStock ?? false,
        lowStock: stock?.lowStock ?? false,
        available: stock?.available ?? 0,
      };
    });

    const reviews = await this.getReviewSummary(product.id);

    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      description: product.description,
      brand: product.brand,
      material: product.material,
      careNotes: product.careNotes,
      fitNotes: product.fitNotes,
      tags: product.tags,
      minPriceKobo: product.minPriceKobo,
      maxPriceKobo: product.maxPriceKobo,
      minPriceUsdCents: product.minPriceUsdCents,
      maxPriceUsdCents: product.maxPriceUsdCents,
      category: product.category,
      collections: product.collections.map((c) => c.collection),
      images: product.images.map((i) => ({
        url: i.url,
        alt: i.alt,
        position: i.position,
        colour: i.colour,
      })),
      options: product.options.map((option) => ({
        id: option.id,
        name: option.name,
        values: option.values.map((v) => ({
          id: v.id,
          value: v.value,
          swatch: v.swatch,
        })),
      })),
      variants,
      inStock: variants.some((v) => v.inStock),
      reviews,
    };
  }

  /**
   * Rating average plus the fit breakdown. "Runs small" on a dress is the
   * single most return-preventing thing on the page, so it ships with the
   * product rather than inside the reviews tab.
   */
  private async getReviewSummary(productId: string) {
    const where = { productId, status: 'APPROVED' as const };

    const [aggregate, fitGroups] = await Promise.all([
      this.prisma.review.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['fitFeedback'],
        where: { ...where, fitFeedback: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const fit = { RUNS_SMALL: 0, TRUE_TO_SIZE: 0, RUNS_LARGE: 0 };
    for (const group of fitGroups) {
      if (group.fitFeedback) fit[group.fitFeedback] = group._count._all;
    }

    return {
      average: aggregate._avg.rating
        ? Math.round(aggregate._avg.rating * 10) / 10
        : null,
      count: aggregate._count._all,
      fit,
    };
  }

  // ── taxonomy ─────────────────────────────────────────────────────────────

  /** The full category tree, nested, for navigation menus. */
  /** Categories that publish a size guide, for the standalone guide page. */
  async listSizeGuides() {
    const categories = await this.prisma.category.findMany({
      orderBy: { position: 'asc' },
      select: { name: true, slug: true, sizeGuide: true },
    });
    return categories.filter((c) => c.sizeGuide !== null);
  }

  async getCategoryTree() {
    const categories = await this.prisma.category.findMany({
      orderBy: { position: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        parentId: true,
      },
    });

    type Node = (typeof categories)[number] & { children: Node[] };

    const nodes = new Map<string, Node>(
      categories.map((c) => [c.id, { ...c, children: [] }]),
    );

    const roots: Node[] = [];

    for (const category of categories) {
      const node = nodes.get(category.id)!;
      if (category.parentId) {
        nodes.get(category.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async listCollections() {
    return this.prisma.collection.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image: true,
      },
    });
  }

  async getCollectionBySlug(slug: string, query: ProductQueryDto) {
    const collection = await this.prisma.collection.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        image: true,
      },
    });

    if (!collection) throw new NotFoundException('Collection not found');

    const products = await this.listProducts({ ...query, collection: slug });

    return { collection, ...products };
  }

  /**
   * Facet values for the filter sidebar, scoped to whatever the shopper has
   * already narrowed to — so a category with no red items offers no red.
   */
  async getFilters(query: ProductQueryDto) {
    const where = await this.buildWhere({
      ...query,
      size: undefined,
      colour: undefined,
    });

    const products = await this.prisma.product.findMany({
      where,
      select: {
        brand: true,
        tags: true,
        minPriceKobo: true,
        maxPriceKobo: true,
        variants: {
          where: { isActive: true },
          select: {
            optionValues: {
              select: {
                value: true,
                swatch: true,
                option: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const optionValues = new Map<
      string,
      Map<string, { value: string; swatch: string | null }>
    >();
    const brands = new Set<string>();
    const tags = new Set<string>();
    let priceMin: number | null = null;
    let priceMax: number | null = null;

    for (const product of products) {
      if (product.brand) brands.add(product.brand);
      for (const tag of product.tags) tags.add(tag);

      priceMin =
        priceMin === null
          ? product.minPriceKobo
          : Math.min(priceMin, product.minPriceKobo);
      priceMax =
        priceMax === null
          ? product.maxPriceKobo
          : Math.max(priceMax, product.maxPriceKobo);

      for (const variant of product.variants) {
        for (const ov of variant.optionValues) {
          const bucket =
            optionValues.get(ov.option.name) ??
            new Map<string, { value: string; swatch: string | null }>();
          bucket.set(ov.value, { value: ov.value, swatch: ov.swatch });
          optionValues.set(ov.option.name, bucket);
        }
      }
    }

    return {
      options: [...optionValues.entries()].map(([name, values]) => ({
        name,
        values: [...values.values()],
      })),
      brands: [...brands].sort(),
      tags: [...tags].sort(),
      priceRange: { minKobo: priceMin ?? 0, maxKobo: priceMax ?? 0 },
    };
  }
}
