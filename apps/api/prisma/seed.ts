/**
 * Development / staging / App Review seed. NEVER runs against production data unless SEED_MODE=review
 * is set explicitly (review accounts are isolated, clearly named, and documented in docs/app-review-notes.md).
 *
 *   pnpm db:seed                      # development sample data
 *   SEED_MODE=review pnpm db:seed     # isolated App Review test merchant + accounts only
 *
 * Passwords come from env vars (SEED_*_PASSWORD); development defaults are printed only in development.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ADMIN_PERMISSIONS, addDays, businessDate, startOfBusinessDay } from '@bitaqati/shared';

const prisma = new PrismaClient();
const appEnv = process.env.APP_ENV ?? 'development';
const mode = process.env.SEED_MODE ?? 'dev';
const TZ = process.env.DEFAULT_TIMEZONE ?? 'Asia/Hebron';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function serial(): string {
  const b = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += CROCKFORD[b[i] & 31];
  return `BT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

function pw(envName: string, devDefault: string): string {
  const v = process.env[envName];
  if (v) return v;
  if (appEnv !== 'development' && appEnv !== 'test') throw new Error(`${envName} must be set outside development`);
  return devDefault;
}

async function hash(p: string) {
  return argon2.hash(p, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

/** Local-storage photo placeholder for development only (S3 environments should upload via the app). */
async function placeholderPhoto(userId: string, label: string): Promise<string | null> {
  if ((process.env.STORAGE_DRIVER ?? 'local') !== 'local') return null;
  const key = `profiles/${userId}/seed-${randomBytes(6).toString('hex')}.jpg`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="#0F2A4A"/><circle cx="300" cy="240" r="120" fill="#1BA37A"/><rect x="140" y="390" width="320" height="170" rx="80" fill="#1BA37A"/><text x="300" y="590" font-size="28" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  const p = join(resolve(process.env.STORAGE_LOCAL_DIR ?? './storage'), key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buf);
  return key;
}

async function upsertUser(email: string, password: string, fullName: string, opts: { photo?: boolean } = {}) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const u = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(password),
      emailVerifiedAt: new Date(),
      profile: { create: { fullName } },
      notificationPrefs: { create: {} },
      cards: { create: { serialNumber: serial(), status: 'ACTIVE' } },
    },
  });
  if (opts.photo) {
    const key = await placeholderPhoto(u.id, fullName);
    if (key) await prisma.userProfile.update({ where: { userId: u.id }, data: { photoKey: key, photoStatus: 'APPROVED', photoReviewedAt: new Date() } });
  }
  return u;
}

async function grantYear(userId: string, planId: string) {
  const now = new Date();
  const endsAt = startOfBusinessDay(addDays(businessDate(now, TZ), 365), TZ);
  const active = await prisma.subscription.findFirst({ where: { userId, status: 'ACTIVE', endsAt: { gt: now } } });
  if (!active) await prisma.subscription.create({ data: { userId, planId, startsAt: now, endsAt, reason: `seed:${mode}`, source: 'SEED' } });
}

async function storeWithOffer(merchantId: string, categoryId: string, s: { nameAr: string; nameEn: string; descAr: string; descEn: string; rateBps: number; branches: Array<{ nameAr: string; nameEn: string; city: string; lat: number; lng: number }> }) {
  const existing = await prisma.store.findFirst({ where: { merchantId, nameEn: s.nameEn } });
  if (existing) return prisma.store.findUniqueOrThrow({ where: { id: existing.id }, include: { branches: true } });
  const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, open: '08:00', close: d === 5 ? '14:00' : '23:00' }));
  return prisma.store.create({
    data: {
      merchantId,
      categoryId,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      descriptionAr: s.descAr,
      descriptionEn: s.descEn,
      status: 'ACTIVE',
      branches: { create: s.branches.map((b) => ({ ...b, addressAr: b.city, addressEn: b.city, openingHours: hours })) },
      offers: { create: { version: 1, rateBps: s.rateBps, termsAr: 'لا يشمل العروض الأخرى.', termsEn: 'Not combinable with other promotions.' } },
    },
    include: { branches: true },
  });
}

async function main() {
  if (appEnv === 'production' && mode !== 'review') throw new Error('Refusing to seed sample data in production. Use SEED_MODE=review for App Review accounts only.');
  console.log(`seeding mode=${mode} env=${appEnv}`);

  const plan = await prisma.plan.upsert({
    where: { code: 'ANNUAL' },
    create: { code: 'ANNUAL', nameAr: 'اشتراك سنوي', nameEn: 'Annual membership', durationDays: 365, priceMinor: 0 },
    update: {},
  });

  if (mode === 'review') {
    // Isolated review merchant — not a real store; clearly labelled.
    const cat = await prisma.category.upsert({ where: { slug: 'review' }, create: { slug: 'review', nameAr: 'تجريبي للمراجعة', nameEn: 'Review (test)', sortOrder: 999 }, update: {} });
    let merchant = await prisma.merchant.findFirst({ where: { nameEn: 'App Review Test Merchant' } });
    merchant ??= await prisma.merchant.create({ data: { nameAr: 'تاجر تجريبي للمراجعة', nameEn: 'App Review Test Merchant', status: 'ACTIVE' } });
    const store = await storeWithOffer(merchant.id, cat.id, {
      nameAr: 'محل تجريبي (مراجعة Apple)',
      nameEn: 'Test Store (App Review)',
      descAr: 'محل تجريبي معزول لأغراض المراجعة فقط.',
      descEn: 'Isolated test store for App Review only.',
      rateBps: 2000,
      branches: [{ nameAr: 'فرع تجريبي', nameEn: 'Test branch', city: 'Ramallah', lat: 31.9038, lng: 35.2034 }],
    });
    const user = await upsertUser(process.env.REVIEW_USER_EMAIL ?? 'review.member@example.com', pw('SEED_REVIEW_USER_PASSWORD', 'ReviewMember2026!'), 'App Review Member', { photo: true });
    await grantYear(user.id, plan.id);
    const staff = await upsertUser(process.env.REVIEW_MERCHANT_EMAIL ?? 'review.merchant@example.com', pw('SEED_REVIEW_MERCHANT_PASSWORD', 'ReviewMerchant2026!'), 'App Review Cashier');
    const m = await prisma.merchantMembership.upsert({ where: { userId_merchantId: { userId: staff.id, merchantId: merchant.id } }, create: { userId: staff.id, merchantId: merchant.id, role: 'OWNER' }, update: { active: true } });
    void m;
    void store;
    console.log('review accounts ready (see docs/app-review-notes.md)');
    return;
  }

  const cats = await Promise.all(
    [
      ['restaurants', 'مطاعم', 'Restaurants'],
      ['cafes', 'مقاهي', 'Cafés'],
      ['fashion', 'أزياء', 'Fashion'],
      ['health', 'صحة وجمال', 'Health & beauty'],
      ['electronics', 'إلكترونيات', 'Electronics'],
    ].map(([slug, ar, en], i) => prisma.category.upsert({ where: { slug }, create: { slug, nameAr: ar, nameEn: en, sortOrder: i }, update: {} })),
  );

  let merchant = await prisma.merchant.findFirst({ where: { nameEn: 'DEV Olive Group' } });
  merchant ??= await prisma.merchant.create({ data: { nameAr: 'مجموعة الزيتون (تطوير)', nameEn: 'DEV Olive Group', status: 'ACTIVE' } });
  const s1 = await storeWithOffer(merchant.id, cats[0].id, {
    nameAr: 'مطعم الزيتون',
    nameEn: 'Olive Restaurant',
    descAr: 'مأكولات فلسطينية تقليدية.',
    descEn: 'Traditional Palestinian cuisine.',
    rateBps: 2000,
    branches: [
      { nameAr: 'فرع رام الله', nameEn: 'Ramallah', city: 'Ramallah', lat: 31.9038, lng: 35.2034 },
      { nameAr: 'فرع نابلس', nameEn: 'Nablus', city: 'Nablus', lat: 32.2211, lng: 35.2544 },
    ],
  });
  await storeWithOffer(merchant.id, cats[1].id, {
    nameAr: 'مقهى القدس',
    nameEn: 'Al-Quds Café',
    descAr: 'قهوة مختصة وحلويات.',
    descEn: 'Specialty coffee and sweets.',
    rateBps: 1500,
    branches: [{ nameAr: 'فرع الخليل', nameEn: 'Hebron', city: 'Hebron', lat: 31.5326, lng: 35.0998 }],
  });

  const admin = await upsertUser('admin@bitaqati.test', pw('SEED_ADMIN_PASSWORD', 'DevAdmin2026!pass'), 'DEV Admin');
  for (const p of ADMIN_PERMISSIONS) await prisma.adminPermissionGrant.upsert({ where: { userId_permission: { userId: admin.id, permission: p } }, create: { userId: admin.id, permission: p }, update: {} });
  const owner = await upsertUser('owner@bitaqati.test', pw('SEED_OWNER_PASSWORD', 'DevOwner2026!pass'), 'DEV Owner');
  await prisma.merchantMembership.upsert({ where: { userId_merchantId: { userId: owner.id, merchantId: merchant.id } }, create: { userId: owner.id, merchantId: merchant.id, role: 'OWNER' }, update: {} });
  const staff = await upsertUser('staff@bitaqati.test', pw('SEED_STAFF_PASSWORD', 'DevStaff2026!pass'), 'DEV Cashier');
  const sm = await prisma.merchantMembership.upsert({ where: { userId_merchantId: { userId: staff.id, merchantId: merchant.id } }, create: { userId: staff.id, merchantId: merchant.id, role: 'STAFF' }, update: {} });
  await prisma.membershipBranch.upsert({ where: { membershipId_branchId: { membershipId: sm.id, branchId: s1.branches[0].id } }, create: { membershipId: sm.id, branchId: s1.branches[0].id }, update: {} });
  const member = await upsertUser('member@bitaqati.test', pw('SEED_MEMBER_PASSWORD', 'DevMember2026!pass'), 'سارة أحمد (تطوير)', { photo: true });
  await grantYear(member.id, plan.id);

  if (appEnv === 'development') {
    console.log('DEVELOPMENT accounts (never use in production):');
    console.log('  admin@bitaqati.test  / DevAdmin2026!pass   (admin web; TOTP enrollment on first login)');
    console.log('  owner@bitaqati.test  / DevOwner2026!pass   (merchant owner)');
    console.log('  staff@bitaqati.test  / DevStaff2026!pass   (cashier, Ramallah branch)');
    console.log('  member@bitaqati.test / DevMember2026!pass  (active member)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
