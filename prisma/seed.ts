/**
 * Development seed: a small but realistic apparel catalog.
 *
 * Idempotent — every write is an upsert keyed on a natural unique field, so
 * running it repeatedly converges rather than duplicating. Safe to re-run
 * after a schema change.
 *
 * Deliberately NOT seeded: users, orders, payments. Those are created through
 * the real flows so the flows themselves stay tested.
 */
// Loaded here as well as in prisma.config.ts so the script also works when
// run directly (`npx tsx prisma/seed.ts`), not just via `prisma db seed`.
import 'dotenv/config';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import slugify from 'slugify';
import { PrismaClient } from '../generated/prisma/client';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
});

const naira = (amount: number) => amount * 100;
const slug = (value: string) => slugify(value, { lower: true, strict: true });

// ── catalog definition ──────────────────────────────────────────────────────

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

interface ProductSeed {
  title: string;
  category: string;
  brand: string;
  description: string;
  material: string;
  careNotes: string;
  fitNotes: string;
  tags: string[];
  priceNaira: number;
  compareAtNaira?: number;
  colours: { name: string; swatch: string }[];
  sizes: string[];
  collections: string[];
}

const PRODUCTS: ProductSeed[] = [
  {
    title: 'Adire Wrap Dress',
    category: 'dresses',
    brand: 'Ilé Studio',
    description:
      'A midi wrap dress in hand-dyed adire cotton. Cut with a deep V and a tie waist that suits most shapes.',
    material: '100% cotton, hand-dyed',
    careNotes: 'Hand wash cold, separately for the first three washes.',
    fitNotes: 'True to size. Size down if you prefer a closer fit at the waist.',
    tags: ['adire', 'midi', 'occasion'],
    priceNaira: 68_000,
    compareAtNaira: 85_000,
    colours: [
      { name: 'Indigo', swatch: '#2B3A67' },
      { name: 'Rust', swatch: '#A4471F' },
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    collections: ['new-in', 'sale'],
  },
  {
    title: 'Oversized Poplin Shirt',
    category: 'tops',
    brand: 'Ilé Studio',
    description:
      'A relaxed cotton poplin shirt with a dropped shoulder and mother-of-pearl buttons.',
    material: '100% organic cotton poplin',
    careNotes: 'Machine wash 30°. Warm iron.',
    fitNotes: 'Runs large — take one size down for a regular fit.',
    tags: ['shirt', 'workwear', 'cotton'],
    priceNaira: 42_000,
    colours: [
      { name: 'White', swatch: '#F7F5F0' },
      { name: 'Sky', swatch: '#9DBFD4' },
      { name: 'Black', swatch: '#16161A' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    collections: ['new-in'],
  },
  {
    title: 'Wide Leg Linen Trouser',
    category: 'trousers',
    brand: 'Marara',
    description:
      'High-waisted wide leg trousers in washed linen, with side pockets and a covered elastic back.',
    material: '55% linen, 45% viscose',
    careNotes: 'Machine wash cold. Line dry.',
    fitNotes: 'True to size.',
    tags: ['linen', 'trousers', 'holiday'],
    priceNaira: 55_000,
    colours: [
      { name: 'Sand', swatch: '#D9C7A7' },
      { name: 'Olive', swatch: '#5C6247' },
    ],
    sizes: ['XS', 'S', 'M', 'L'],
    collections: ['new-in'],
  },
  {
    title: 'Aso Oke Blazer',
    category: 'outerwear',
    brand: 'Marara',
    description:
      'A single-breasted blazer with aso oke panelling at the lapel and cuff. Fully lined.',
    material: 'Cotton blend shell, aso oke trim, viscose lining',
    careNotes: 'Dry clean only.',
    fitNotes: 'Cut close through the shoulder. Size up to layer.',
    tags: ['blazer', 'occasion', 'aso-oke'],
    priceNaira: 125_000,
    colours: [{ name: 'Charcoal', swatch: '#3A3A3C' }],
    sizes: ['S', 'M', 'L'],
    collections: ['occasion'],
  },
  {
    title: 'Ribbed Knit Tank',
    category: 'tops',
    brand: 'Basics by Ilé',
    description: 'A fitted ribbed tank in a heavyweight stretch cotton.',
    material: '95% cotton, 5% elastane',
    careNotes: 'Machine wash 30°. Do not tumble dry.',
    fitNotes: 'Runs small — size up.',
    tags: ['basics', 'knit'],
    priceNaira: 18_000,
    compareAtNaira: 24_000,
    colours: [
      { name: 'Black', swatch: '#16161A' },
      { name: 'Cream', swatch: '#EFE7D8' },
      { name: 'Forest', swatch: '#2F4231' },
    ],
    sizes: ['XS', 'S', 'M', 'L'],
    collections: ['sale'],
  },
  {
    title: 'Pleated Midi Skirt',
    category: 'skirts',
    brand: 'Marara',
    description: 'A sunray-pleated midi skirt in a fluid satin-back crepe.',
    material: '100% polyester crepe',
    careNotes: 'Dry clean recommended.',
    fitNotes: 'True to size. Sits at the natural waist.',
    tags: ['skirt', 'pleated', 'occasion'],
    priceNaira: 47_500,
    colours: [
      { name: 'Bronze', swatch: '#8C6239' },
      { name: 'Ink', swatch: '#1F2233' },
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    collections: ['occasion', 'new-in'],
  },
];

// Deterministic per-variant stock so re-running the seed does not silently
// change availability out from under a test.
function stockFor(size: string, colourIndex: number): number {
  if (size === 'XS') return colourIndex === 0 ? 2 : 0; // exercises low/out of stock
  if (size === 'XL') return 3;
  return 8 + colourIndex;
}

async function seedCategories() {
  const women = await prisma.category.upsert({
    where: { slug: 'women' },
    update: {},
    create: { name: 'Women', slug: 'women', position: 0 },
  });

  const children = [
    { name: 'Dresses', slug: 'dresses' },
    { name: 'Tops', slug: 'tops' },
    { name: 'Trousers', slug: 'trousers' },
    { name: 'Skirts', slug: 'skirts' },
    { name: 'Outerwear', slug: 'outerwear' },
  ];

  const sizeGuide = {
    columns: ['Size', 'Bust (cm)', 'Waist (cm)', 'Hip (cm)'],
    rows: [
      { label: 'XS', values: ['XS', '82', '64', '90'] },
      { label: 'S', values: ['S', '86', '68', '94'] },
      { label: 'M', values: ['M', '90', '72', '98'] },
      { label: 'L', values: ['L', '96', '78', '104'] },
      { label: 'XL', values: ['XL', '102', '84', '110'] },
    ],
  };

  for (const [index, child] of children.entries()) {
    await prisma.category.upsert({
      where: { slug: child.slug },
      update: { parentId: women.id, sizeGuide },
      create: {
        name: child.name,
        slug: child.slug,
        parentId: women.id,
        position: index,
        sizeGuide,
      },
    });
  }

  console.log(`  categories: 1 parent, ${children.length} children`);
}

async function seedCollections() {
  const collections = [
    { name: 'New In', slug: 'new-in', description: 'The latest arrivals.' },
    { name: 'Occasion', slug: 'occasion', description: 'For the events.' },
    { name: 'Sale', slug: 'sale', description: 'Marked down while stocks last.' },
  ];

  for (const [index, collection] of collections.entries()) {
    await prisma.collection.upsert({
      where: { slug: collection.slug },
      update: {},
      create: { ...collection, position: index, isActive: true },
    });
  }

  console.log(`  collections: ${collections.length}`);
}

async function seedDeliveryZones() {
  const zones = [
    {
      name: 'Lagos Island',
      states: ['Lagos'],
      cities: ['Ikoyi', 'Victoria Island', 'Lekki', 'Ajah'],
      feeKobo: naira(2_500),
      freeAboveKobo: naira(100_000),
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
      allowPayOnDelivery: true,
    },
    {
      name: 'Lagos Mainland',
      states: ['Lagos'],
      cities: ['Ikeja', 'Yaba', 'Surulere', 'Maryland', 'Gbagada'],
      feeKobo: naira(3_000),
      freeAboveKobo: naira(100_000),
      estimatedMinDays: 1,
      estimatedMaxDays: 3,
      allowPayOnDelivery: true,
    },
    {
      // No cities: the catch-all for anywhere else in Lagos.
      name: 'Lagos (other)',
      states: ['Lagos'],
      cities: [],
      feeKobo: naira(4_000),
      freeAboveKobo: naira(120_000),
      estimatedMinDays: 2,
      estimatedMaxDays: 4,
      allowPayOnDelivery: true,
    },
    {
      name: 'Abuja & Central',
      states: ['FCT', 'Abuja', 'Nasarawa', 'Niger', 'Kogi'],
      cities: [],
      feeKobo: naira(6_500),
      freeAboveKobo: naira(150_000),
      estimatedMinDays: 2,
      estimatedMaxDays: 5,
      allowPayOnDelivery: true,
    },
    {
      name: 'Nationwide',
      states: [
        'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
        'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti',
        'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
        'Kebbi', 'Kwara', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
        'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
      ],
      cities: [],
      feeKobo: naira(8_500),
      freeAboveKobo: null,
      estimatedMinDays: 3,
      estimatedMaxDays: 7,
      // Cash on delivery is not viable this far out.
      allowPayOnDelivery: false,
    },
  ];

  for (const zone of zones) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { name: zone.name },
    });

    if (existing) {
      await prisma.deliveryZone.update({
        where: { id: existing.id },
        data: zone,
      });
    } else {
      await prisma.deliveryZone.create({ data: zone });
    }
  }

  console.log(`  delivery zones: ${zones.length}`);
}

async function seedProducts() {
  let variantCount = 0;

  for (const seed of PRODUCTS) {
    const category = await prisma.category.findUnique({
      where: { slug: seed.category },
    });

    if (!category) throw new Error(`Missing category ${seed.category}`);

    const productSlug = slug(seed.title);
    const prices = [naira(seed.priceNaira)];

    const product = await prisma.product.upsert({
      where: { slug: productSlug },
      update: {
        status: 'ACTIVE',
        minPriceKobo: Math.min(...prices),
        maxPriceKobo: Math.max(...prices),
      },
      create: {
        title: seed.title,
        slug: productSlug,
        description: seed.description,
        categoryId: category.id,
        brand: seed.brand,
        material: seed.material,
        careNotes: seed.careNotes,
        fitNotes: seed.fitNotes,
        tags: seed.tags,
        status: 'ACTIVE',
        publishedAt: new Date(),
        minPriceKobo: Math.min(...prices),
        maxPriceKobo: Math.max(...prices),
      },
    });

    // Placeholder imagery — swap for real R2 URLs when the shoot lands.
    const existingImages = await prisma.productImage.count({
      where: { productId: product.id },
    });

    if (existingImages === 0) {
      await prisma.productImage.createMany({
        data: [0, 1].map((position) => ({
          productId: product.id,
          url: `https://placehold.co/900x1200/EFE7D8/16161A?text=${encodeURIComponent(seed.title)}`,
          alt: `${seed.title} — view ${position + 1}`,
          position,
        })),
      });
    }

    // Collections
    for (const collectionSlug of seed.collections) {
      const collection = await prisma.collection.findUnique({
        where: { slug: collectionSlug },
      });
      if (!collection) continue;

      await prisma.productCollection.upsert({
        where: {
          productId_collectionId: {
            productId: product.id,
            collectionId: collection.id,
          },
        },
        update: {},
        create: { productId: product.id, collectionId: collection.id },
      });
    }

    // Options: Size then Colour
    const sizeOption = await prisma.productOption.upsert({
      where: { productId_name: { productId: product.id, name: 'Size' } },
      update: {},
      create: { productId: product.id, name: 'Size', position: 0 },
    });

    const colourOption = await prisma.productOption.upsert({
      where: { productId_name: { productId: product.id, name: 'Colour' } },
      update: {},
      create: { productId: product.id, name: 'Colour', position: 1 },
    });

    const sizeValues = new Map<string, string>();
    for (const size of seed.sizes) {
      const value = await prisma.productOptionValue.upsert({
        where: { optionId_value: { optionId: sizeOption.id, value: size } },
        update: {},
        create: {
          optionId: sizeOption.id,
          value: size,
          position: SIZES.indexOf(size),
        },
      });
      sizeValues.set(size, value.id);
    }

    const colourValues = new Map<string, string>();
    for (const [index, colour] of seed.colours.entries()) {
      const value = await prisma.productOptionValue.upsert({
        where: {
          optionId_value: { optionId: colourOption.id, value: colour.name },
        },
        update: { swatch: colour.swatch },
        create: {
          optionId: colourOption.id,
          value: colour.name,
          swatch: colour.swatch,
          position: index,
        },
      });
      colourValues.set(colour.name, value.id);
    }

    // The variant matrix: every size × colour combination.
    for (const [colourIndex, colour] of seed.colours.entries()) {
      for (const size of seed.sizes) {
        const sku = `${slug(seed.title).toUpperCase().slice(0, 12)}-${slug(colour.name).toUpperCase().slice(0, 6)}-${size}`;

        await prisma.productVariant.upsert({
          where: { sku },
          update: {
            priceKobo: naira(seed.priceNaira),
            compareAtPriceKobo: seed.compareAtNaira
              ? naira(seed.compareAtNaira)
              : null,
            stock: stockFor(size, colourIndex),
            isActive: true,
          },
          create: {
            productId: product.id,
            sku,
            priceKobo: naira(seed.priceNaira),
            compareAtPriceKobo: seed.compareAtNaira
              ? naira(seed.compareAtNaira)
              : null,
            costKobo: Math.round(naira(seed.priceNaira) * 0.4),
            stock: stockFor(size, colourIndex),
            lowStockAt: 3,
            weightGrams: 400,
            isActive: true,
            optionValues: {
              connect: [
                { id: sizeValues.get(size)! },
                { id: colourValues.get(colour.name)! },
              ],
            },
          },
        });

        variantCount++;
      }
    }
  }

  console.log(`  products: ${PRODUCTS.length}, variants: ${variantCount}`);
}

async function seedDiscounts() {
  const discounts = [
    {
      code: 'WELCOME10',
      type: 'PERCENTAGE' as const,
      value: 10,
      maxDiscountKobo: naira(10_000),
      minSubtotalKobo: naira(30_000),
      perUserLimit: 1,
    },
    {
      code: 'FREESHIP',
      type: 'FREE_SHIPPING' as const,
      value: 0,
      minSubtotalKobo: naira(50_000),
      perUserLimit: null,
    },
    {
      code: 'SAVE5K',
      type: 'FIXED_AMOUNT' as const,
      value: naira(5_000),
      minSubtotalKobo: naira(40_000),
      perUserLimit: 2,
    },
  ];

  for (const discount of discounts) {
    await prisma.discount.upsert({
      where: { code: discount.code },
      update: {},
      create: { ...discount, isActive: true },
    });
  }

  console.log(`  discounts: ${discounts.length}`);
}

async function main() {
  console.log('Seeding…');

  await seedCategories();
  await seedCollections();
  await seedDeliveryZones();
  await seedProducts();
  await seedDiscounts();

  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
