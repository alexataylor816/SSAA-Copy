/**
 * Mirrors the Supabase `permission_level` enum.
 *
 * account_holder > full > partial > level_1 > basic/standard.
 */
export enum PermissionLevel {
  Standard = "standard",
  Level1 = "level_1",
  Partial = "partial",
  Full = "full",
  AccountHolder = "account_holder",
}

export const HIERARCHY: Record<PermissionLevel, number> = {
  [PermissionLevel.Standard]: 0,
  [PermissionLevel.Level1]: 1,
  [PermissionLevel.Partial]: 2,
  [PermissionLevel.Full]: 3,
  [PermissionLevel.AccountHolder]: 4,
};

// Middleware enforcing these levels (replacing Supabase RLS) lands in Phase 1.
