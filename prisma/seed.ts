/**
 * ELO launch seed: store settings, the Softies catalogue, delivery zones and
 * a welcome code.
 *
 * Idempotent. Every write is an upsert keyed on a natural unique field, so
 * re-running converges instead of duplicating. Settings and products are only
 * CREATED here; once ELO edits them in the admin, a re-run leaves her changes
 * alone (pass --reset-settings to overwrite the store settings).
 *
 * Prices, stock, sizes and delivery fees are launch placeholders taken from
 * the concept. ELO confirms or edits them in the admin.
 *
 * Product photos point at /images/products/*, served by the storefront's
 * public folder, so the catalogue works before an R2 bucket exists.
 */
import slugify from 'slugify';
import { createPrisma } from '../scripts/db';

const prisma = createPrisma();

const naira = (amount: number) => amount * 100;
const dollars = (amount: number) => amount * 100;
const slug = (value: string) => slugify(value, { lower: true, strict: true });
const img = (file: string) => `/images/products/${file}`;

const RESET_SETTINGS = process.argv.includes('--reset-settings');

// ── brand ───────────────────────────────────────────────────────────────────

const COLOURS = {
  Lilac: '#BFA6E3',
  Lime: '#B3BC25',
  Sky: '#A9C9EE',
} as const;
type Colour = keyof typeof COLOURS;

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

// Body measurements, not garment measurements. Modal stretches, so a range
// per size is honest. Placeholder until ELO sends her pattern sizes.
const SIZE_GUIDE = {
  columns: ['Size', 'UK', 'US', 'Bust (cm)', 'Waist (cm)', 'Hip (cm)'],
  rows: [
    { label: 'XS', values: ['XS', '6', '2', '78–82', '60–64', '86–90'] },
    { label: 'S', values: ['S', '8', '4', '82–86', '64–68', '90–94'] },
    { label: 'M', values: ['M', '10', '6', '86–92', '68–74', '94–100'] },
    { label: 'L', values: ['L', '12–14', '8–10', '92–100', '74–82', '100–108'] },
    { label: 'XL', values: ['XL', '16', '12', '100–108', '82–90', '108–116'] },
  ],
};

const MODAL = '92% modal, 8% elastane. Lace trim: 100% nylon.';
const CARE =
  'Hand wash cold or machine wash 30° on a delicate cycle inside a mesh bag. Do not tumble dry; lay flat to dry. Cool iron on the reverse if needed.';

// ── catalogue ───────────────────────────────────────────────────────────────

interface ProductSeed {
  title: string;
  category: string;
  description: string;
  material: string;
  fitNotes: string;
  tags: string[];
  priceNaira: number;
  priceUsd: number;
  colours: Colour[] | null; // null = sold as a fixed mix (the Trio)
  // [file, alt, colour | null]
  images: [string, string, Colour | null][];
  collections: string[];
  stock: (size: string, colour: Colour | null) => number;
}

const PRODUCTS: ProductSeed[] = [
  {
    title: 'The Softie Slip Dress',
    category: 'dresses',
    description:
      'Our everyday slip, made to be lived in. Fluid modal skims a fitted body, a whisper of lace edges the neckline, and inset godet panels flare into a soft, floor-grazing sweep. Wear it for slow mornings, long lunches and everything in between.',
    material: MODAL,
    fitNotes:
      'Body-skimming with plenty of stretch. True to size. If you are between sizes, size up for a softer drape through the hip.',
    tags: ['bestseller', 'slip dress', 'maxi', 'lace trim'],
    priceNaira: 58_000,
    priceUsd: 42,
    colours: ['Lilac', 'Lime', 'Sky'],
    images: [
      ['elo-16.jpg', 'Model in the lilac Softie Slip Dress', 'Lilac'],
      ['elo-00.jpg', 'Full-length view of the lilac slip dress', 'Lilac'],
      ['elo-01.jpg', 'The lime slip dress from the back, side and front', 'Lime'],
      ['elo-11.jpg', 'Model in the sky Softie Slip Dress', 'Sky'],
    ],
    collections: ['the-softies', 'bestsellers'],
    stock: (size) => (size === 'XL' ? 4 : size === 'XS' ? 3 : 10),
  },
  {
    title: 'The Softie Set',
    category: 'sets',
    description:
      'The slip dress and its matching wrap robe, together. Throw the robe over for the school run, slip it off for dinner. Fitted body, lace trim, godet hem and a long, fluid robe with wide sleeves, all in our signature modal.',
    material: MODAL,
    fitNotes:
      'Choose your dress size; the robe is cut generously to layer over it. True to size.',
    tags: ['new', 'set', 'robe', 'slip dress', 'gift'],
    priceNaira: 95_000,
    priceUsd: 68,
    colours: ['Lilac', 'Lime', 'Sky'],
    images: [
      ['elo-02.jpg', 'Model in the lime Softie Set: slip dress and robe', 'Lime'],
      ['elo-03.jpg', 'The lime set on a model beside the full ELO rail', 'Lime'],
      ['elo-14.jpg', 'Model in the lilac Softie Set', 'Lilac'],
      ['elo-17.jpg', 'The lilac set with the robe worn open', 'Lilac'],
      ['elo-18.jpg', 'Lilac set details: robe, lace, fitted body, modal', 'Lilac'],
      ['elo-12.jpg', 'Model in the sky Softie Set', 'Sky'],
      ['elo-13.jpg', 'Sky set details: fitted robe, lace trim, godet hem', 'Sky'],
    ],
    collections: ['the-softies', 'new-in', 'gifts'],
    stock: (size) => (size === 'XL' ? 3 : size === 'XS' ? 2 : 8),
  },
  {
    title: 'The Wrap Robe',
    category: 'robes',
    description:
      'A long, belted robe in fluid modal with wide sleeves that fall just right. Tie it closed for a softly structured silhouette or leave it open over the slip dress.',
    material: MODAL,
    fitNotes:
      'Relaxed fit with a removable self-tie belt. One size up gives an even more enveloping drape.',
    tags: ['robe', 'loungewear', 'gift'],
    priceNaira: 45_000,
    priceUsd: 32,
    colours: ['Lilac', 'Lime', 'Sky'],
    images: [
      ['elo-15.jpg', 'The lilac Wrap Robe, belted, front and back', 'Lilac'],
      ['elo-01.jpg', 'The lime robe worn open over the slip dress', 'Lime'],
      ['elo-12.jpg', 'The sky robe worn over the slip dress', 'Sky'],
    ],
    collections: ['the-softies', 'gifts'],
    stock: (size) => (size === 'XL' ? 4 : 9),
  },
  {
    title: 'The Softie Trio',
    category: 'gifts',
    description:
      'All three robes, Lilac, Lime and Sky, gift-wrapped together in ELO tissue and ribbon. One for every mood, or a set to share with your girls.',
    material: MODAL,
    fitNotes: 'All three robes come in the size you choose.',
    tags: ['gift', 'bundle', 'robe'],
    priceNaira: 120_000,
    priceUsd: 86,
    colours: null,
    images: [
      ['elo-21.jpg', 'ELO robes in sky, lime and lilac on a rail', null],
      ['elo-19.jpg', 'ELO orders wrapped in tissue with lilac ribbon', null],
    ],
    collections: ['the-softies', 'gifts'],
    stock: (size) => (size === 'XL' || size === 'XS' ? 2 : 5),
  },
];

const CATEGORIES = [
  { name: 'Dresses', slug: 'dresses' },
  { name: 'Robes', slug: 'robes' },
  { name: 'Sets', slug: 'sets' },
  { name: 'Gifts', slug: 'gifts' },
];

const COLLECTIONS = [
  {
    name: 'The Softies',
    slug: 'the-softies',
    description:
      'Fluid modal dresses and robes, cut to hold you gently from morning coffee to midnight conversation.',
    image: img('elo-03.jpg'),
  },
  {
    name: 'New In',
    slug: 'new-in',
    description: 'Fresh from the Lagos studio.',
    image: img('elo-02.jpg'),
  },
  {
    name: 'Bestsellers',
    slug: 'bestsellers',
    description: 'The pieces Softies reach for first.',
    image: img('elo-16.jpg'),
  },
  {
    name: 'Gifts',
    slug: 'gifts',
    description:
      'Every order arrives hand-wrapped in ELO tissue and ribbon, ready to give.',
    image: img('elo-19.jpg'),
  },
];

// ── delivery ────────────────────────────────────────────────────────────────

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'Abuja (FCT)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

const ZONES = [
  {
    name: 'Lagos',
    countries: ['NG'],
    states: ['Lagos'],
    feeKobo: naira(4_000),
    freeAboveKobo: naira(150_000),
    estimatedMinDays: 1,
    estimatedMaxDays: 3,
    allowPayOnDelivery: true,
  },
  {
    name: 'Rest of Nigeria',
    countries: ['NG'],
    states: NIGERIAN_STATES.filter((s) => s !== 'Lagos'),
    feeKobo: naira(7_500),
    freeAboveKobo: naira(200_000),
    estimatedMinDays: 2,
    estimatedMaxDays: 5,
    allowPayOnDelivery: false,
  },
  {
    name: 'West Africa',
    countries: ['GH', 'BJ', 'TG', 'CI', 'SN', 'CM', 'SL', 'LR', 'GM'],
    feeKobo: naira(40_000),
    feeUsdCents: dollars(28),
    estimatedMinDays: 5,
    estimatedMaxDays: 10,
  },
  {
    name: 'UK & Europe',
    countries: [
      'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'IT', 'ES', 'PT', 'AT', 'CH',
      'SE', 'NO', 'DK', 'FI', 'PL',
    ],
    feeKobo: naira(63_000),
    feeUsdCents: dollars(45),
    freeAboveKobo: naira(420_000),
    freeAboveUsdCents: dollars(300),
    estimatedMinDays: 5,
    estimatedMaxDays: 10,
  },
  {
    name: 'North America',
    countries: ['US', 'CA'],
    feeKobo: naira(70_000),
    feeUsdCents: dollars(50),
    freeAboveKobo: naira(420_000),
    freeAboveUsdCents: dollars(300),
    estimatedMinDays: 6,
    estimatedMaxDays: 12,
  },
  {
    name: 'Rest of the world',
    countries: ['*'],
    feeKobo: naira(84_000),
    feeUsdCents: dollars(60),
    estimatedMinDays: 7,
    estimatedMaxDays: 14,
  },
];

// ── settings ────────────────────────────────────────────────────────────────

const SETTINGS = {
  name: 'ELO',
  tagline: 'Softly worn',
  logoUrl: null,
  faviconUrl: '/icon.svg',
  ogImageUrl: '/images/og.jpg',
  theme: {
    primary: '#2B2A26',
    primaryForeground: '#F7F4EF',
    background: '#F7F4EF',
    foreground: '#2B2A26',
    muted: '#ECE7DF',
    accent: '#8C8A3A',
    fontHeading: 'Cormorant Garamond',
    fontBody: 'Outfit',
    radius: '0.75rem',
  },
  announcement:
    'Complimentary gift wrapping on every order · Shipping from Lagos to the world',
  heroEyebrow: 'The Softies Collection',
  heroTitle: 'Softly worn. *Everyday* ease.',
  heroSubtitle:
    'Elevated essentials for effortless living. Fluid modal dresses and robes, cut to hold you gently from morning coffee to midnight conversation.',
  heroImageUrl: img('elo-02.jpg'),
  heroCtaLabel: 'Shop the collection',
  heroCtaHref: '/shop',
  instagram: 'elo_brandshop',
  enablePayOnDelivery: false,
  enableUsd: true,
  ngnPerUsd: 1400,
  metaTitle: 'ELO · Softly worn',
  metaDescription:
    'Elevated essentials for effortless living. Fluid modal slip dresses, robes and sets, hand-wrapped in Lagos and shipped worldwide.',
  shippingPolicy: `## Where we ship

We ship from Lagos to anywhere in Nigeria and to most countries worldwide. Delivery fees and timelines for your address are shown at checkout before you pay.

## When your order leaves

Orders are hand-folded, wrapped in ELO tissue and dispatched within 1–2 working days. You'll get an email with tracking as soon as your parcel is on its way.

## Delivery times

- Lagos: 1–3 working days
- Rest of Nigeria: 2–5 working days
- International: 5–14 working days, depending on destination

## Customs and duties

International orders may be subject to import duties or taxes charged by your country. These are not included in our prices and are the responsibility of the recipient.`,
  returnsPolicy: `## Exchanges for fit

Wrong size? We'll gladly exchange unworn pieces within 7 days of delivery. Message us on WhatsApp or Instagram with your order number to arrange it.

## Returns

Because our pieces are worn close to the body, we can only accept returns of items that are unworn, unwashed and in their original packaging with tags attached, within 7 days of delivery.

## Faulty items

If something arrives damaged or not as described, contact us within 48 hours with photos and we'll make it right.

## Refunds

Approved refunds are made to your original payment method within 7 working days of us receiving the item. Delivery fees are non-refundable.`,
  privacyPolicy: `## What we collect

When you place an order we collect your name, email, phone number and delivery address so we can fulfil and deliver it. Payments are handled securely by Paystack; we never see or store your card details.

## How we use it

We use your details to process orders, send order updates and answer your questions. If you join our mailing list, we'll occasionally email you about new colours and restocks; you can unsubscribe at any time.

## Sharing

We share your delivery details only with the courier delivering your order. We never sell your data.

## Your rights

You can ask us to see, correct or delete your personal data at any time by contacting us.`,
  termsOfService: `## Orders

All orders are subject to availability. Once your payment is confirmed we'll email you an order confirmation.

## Pricing

Prices are shown in Nigerian naira or US dollars. We may update prices at any time, but the price you pay is the one shown at checkout.

## Colours

We do our best to show our colours accurately, but screens vary and the shade you receive may differ slightly.

## Contact

Questions about these terms? Message us on WhatsApp or Instagram @elo_brandshop.`,
};

// ── seeders ─────────────────────────────────────────────────────────────────

async function seedSettings() {
  const existing = await prisma.storeSettings.findUnique({
    where: { id: 'store' },
  });
  if (existing && !RESET_SETTINGS) {
    // Only fill fields that are still at their fresh defaults.
    if (existing.name === 'My Store' || existing.name === 'ELO') {
      await prisma.storeSettings.update({
        where: { id: 'store' },
        data: Object.fromEntries(
          Object.entries(SETTINGS).filter(
            ([key]) =>
              existing[key as keyof typeof existing] === null ||
              key === 'theme',
          ),
        ),
      });
    }
    console.log('  settings: kept (filled blanks)');
    return;
  }
  await prisma.storeSettings.upsert({
    where: { id: 'store' },
    update: SETTINGS,
    create: { id: 'store', ...SETTINGS },
  });
  console.log('  settings: written');
}

async function seedTaxonomy() {
  for (const [position, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { sizeGuide: SIZE_GUIDE },
      create: { ...category, position, sizeGuide: SIZE_GUIDE },
    });
  }
  for (const [position, collection] of COLLECTIONS.entries()) {
    await prisma.collection.upsert({
      where: { slug: collection.slug },
      update: {},
      create: { ...collection, position, isActive: true },
    });
  }
  console.log(
    `  categories: ${CATEGORIES.length}, collections: ${COLLECTIONS.length}`,
  );
}

async function seedZones() {
  for (const [position, zone] of ZONES.entries()) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { name: zone.name },
    });
    if (existing) continue;
    await prisma.deliveryZone.create({
      data: { states: [], allowPayOnDelivery: false, ...zone, position },
    });
  }
  console.log(`  delivery zones: ${ZONES.length}`);
}

async function seedProducts() {
  let variantCount = 0;

  for (const seed of PRODUCTS) {
    const productSlug = slug(seed.title.replace(/^The /, ''));
    if (await prisma.product.findUnique({ where: { slug: productSlug } })) {
      continue;
    }

    const category = await prisma.category.findUniqueOrThrow({
      where: { slug: seed.category },
    });

    const product = await prisma.product.create({
      data: {
        title: seed.title,
        slug: productSlug,
        description: seed.description,
        categoryId: category.id,
        brand: 'ELO',
        material: seed.material,
        careNotes: CARE,
        fitNotes: seed.fitNotes,
        tags: seed.tags,
        status: 'ACTIVE',
        publishedAt: new Date(),
        minPriceKobo: naira(seed.priceNaira),
        maxPriceKobo: naira(seed.priceNaira),
        minPriceUsdCents: dollars(seed.priceUsd),
        maxPriceUsdCents: dollars(seed.priceUsd),
        images: {
          create: seed.images.map(([file, alt, colour], position) => ({
            url: img(file),
            alt,
            colour,
            position,
          })),
        },
        collections: {
          create: (
            await prisma.collection.findMany({
              where: { slug: { in: seed.collections } },
            })
          ).map((c) => ({ collectionId: c.id })),
        },
      },
    });

    const sizeOption = await prisma.productOption.create({
      data: {
        productId: product.id,
        name: 'Size',
        position: 0,
        values: {
          create: SIZES.map((value, position) => ({ value, position })),
        },
      },
      include: { values: true },
    });

    const colourOption = seed.colours
      ? await prisma.productOption.create({
          data: {
            productId: product.id,
            name: 'Colour',
            position: 1,
            values: {
              create: seed.colours.map((value, position) => ({
                value,
                swatch: COLOURS[value],
                position,
              })),
            },
          },
          include: { values: true },
        })
      : null;

    const code = productSlug.replace(/-/g, '').toUpperCase().slice(0, 8);

    for (const colour of seed.colours ?? [null]) {
      for (const size of SIZES) {
        const sizeId = sizeOption.values.find((v) => v.value === size)!.id;
        const colourId = colourOption?.values.find(
          (v) => v.value === colour,
        )?.id;
        await prisma.productVariant.create({
          data: {
            productId: product.id,
            sku: `ELO-${code}${colour ? `-${colour.toUpperCase()}` : ''}-${size}`,
            priceKobo: naira(seed.priceNaira),
            priceUsdCents: dollars(seed.priceUsd),
            stock: seed.stock(size, colour),
            lowStockAt: 2,
            weightGrams: seed.category === 'sets' ? 700 : 450,
            isActive: true,
            image: colour
              ? (seed.images.find(([, , c]) => c === colour)?.[0] &&
                  img(seed.images.find(([, , c]) => c === colour)![0])) ||
                null
              : null,
            optionValues: {
              connect: [{ id: sizeId }, ...(colourId ? [{ id: colourId }] : [])],
            },
          },
        });
        variantCount++;
      }
    }
  }

  console.log(`  products: ${PRODUCTS.length}, variants created: ${variantCount}`);
}

async function seedDiscounts() {
  await prisma.discount.upsert({
    where: { code: 'SOFTIE10' },
    update: {},
    create: {
      code: 'SOFTIE10',
      type: 'PERCENTAGE',
      value: 10,
      perUserLimit: 1,
      isActive: true,
    },
  });
  console.log('  discounts: SOFTIE10');
}

async function main() {
  console.log('Seeding ELO…');
  await seedSettings();
  await seedTaxonomy();
  await seedZones();
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
