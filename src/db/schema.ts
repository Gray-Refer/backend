import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// shops — one row per Shopify store (multi-tenant)
// ---------------------------------------------------------------------------
export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  accessToken: varchar('access_token', { length: 255 }).notNull(),
  webhookSecret: varchar('webhook_secret', { length: 255 }),
  referralThreshold: integer('referral_threshold').notNull().default(10),
  rewardValue: integer('reward_value').notNull().default(1000), // INR
  validationDelayDays: integer('validation_delay_days').notNull().default(7),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// users — one row per customer (scoped to shop)
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  shopifyCustomerId: varchar('shopify_customer_id', { length: 64 }),
  referralCode: varchar('referral_code', { length: 24 }).notNull().unique(),
  referralCount: integer('referral_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// referrals — tracks each referred purchase
// ---------------------------------------------------------------------------
export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  referrerId: uuid('referrer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  referredEmail: varchar('referred_email', { length: 255 }).notNull(),
  referredOrderId: varchar('referred_order_id', { length: 64 }).notNull(),
  referredOrderAmount: integer('referred_order_amount').notNull(), // paise
  ipAddress: varchar('ip_address', { length: 45 }),
  // pending → approved (order held for validation delay) or rejected (refunded / self-referral)
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  validatedAt: timestamp('validated_at'),
});

// ---------------------------------------------------------------------------
// rewards — milestone reward earned after threshold referrals
// ---------------------------------------------------------------------------
export const rewards = pgTable('rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 20 }).notNull().default('discount'),
  value: integer('value').notNull(), // INR
  // locked → unlocked (threshold hit) → redeemed (coupon used)
  status: varchar('status', { length: 20 }).notNull().default('locked'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  unlockedAt: timestamp('unlocked_at'),
  redeemedAt: timestamp('redeemed_at'),
});

// ---------------------------------------------------------------------------
// discounts — Shopify discount codes generated per reward
// ---------------------------------------------------------------------------
export const discounts = pgTable('discounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  rewardId: uuid('reward_id')
    .notNull()
    .references(() => rewards.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  shopId: uuid('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 100 }).notNull().unique(),
  shopifyDiscountId: varchar('shopify_discount_id', { length: 255 }),
  value: integer('value').notNull(), // INR
  // active → used | expired
  status: varchar('status', { length: 20 }).notNull().default('active'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  usedAt: timestamp('used_at'),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const shopsRelations = relations(shops, ({ many }) => ({
  users: many(users),
  referrals: many(referrals),
  rewards: many(rewards),
  discounts: many(discounts),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  shop: one(shops, { fields: [users.shopId], references: [shops.id] }),
  referrals: many(referrals),
  rewards: many(rewards),
  discounts: many(discounts),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(users, { fields: [referrals.referrerId], references: [users.id] }),
  shop: one(shops, { fields: [referrals.shopId], references: [shops.id] }),
}));

export const rewardsRelations = relations(rewards, ({ one, many }) => ({
  user: one(users, { fields: [rewards.userId], references: [users.id] }),
  shop: one(shops, { fields: [rewards.shopId], references: [shops.id] }),
  discounts: many(discounts),
}));

export const discountsRelations = relations(discounts, ({ one }) => ({
  reward: one(rewards, { fields: [discounts.rewardId], references: [rewards.id] }),
  user: one(users, { fields: [discounts.userId], references: [users.id] }),
  shop: one(shops, { fields: [discounts.shopId], references: [shops.id] }),
}));

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------
export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
export type Reward = typeof rewards.$inferSelect;
export type NewReward = typeof rewards.$inferInsert;
export type Discount = typeof discounts.$inferSelect;
export type NewDiscount = typeof discounts.$inferInsert;
