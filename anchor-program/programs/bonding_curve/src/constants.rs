use anchor_lang::prelude::*;

/// عدد الخانات العشرية المتوقع لعملات هذا المنصّة (لازم يطابق ما تستخدمه في mint العملة)
pub const TOKEN_DECIMALS: u8 = 6;

/// الاحتياطي الافتراضي (الوهمي) الابتدائي من التوكن — يحدد شكل منحنى السعر
/// (نفس القيمة التي استخدمناها في محاكاة الواجهة lib/mockData.ts)
pub const INITIAL_VIRTUAL_TOKEN_RESERVES: u64 = 1_073_000_000 * 1_000_000; // × 10^6 decimals

/// الاحتياطي الافتراضي الابتدائي من SOL (بوحدة lamports) — 30 SOL
pub const INITIAL_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000;

/// الحد الأدنى من SOL الحقيقي المجموع الذي يعتبر عنده المنحنى "مكتمل" (تخرّج)
/// عند الوصول له تتوقف التداولات على المنحنى وتصبح جاهزة للترحيل إلى بركة سيولة دائمة
pub const CURVE_COMPLETE_SOL_THRESHOLD: u64 = 85_000_000_000; // 85 SOL

/// رسوم المنصة بالنقاط الأساسية (basis points). 100 = 1%
pub const DEFAULT_FEE_BASIS_POINTS: u64 = 100;

pub const GLOBAL_SEED: &[u8] = b"global";
pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const CURVE_VAULT_SEED: &[u8] = b"curve-vault";

/// seed لحساب تخصيص الحجز القابل للمطالبة (Claimable Allocation)
pub const CLAIM_SEED: &[u8] = b"claim";

/// seed لخزينة أرباح الـ Creator المتراكمة (Creator Fee Vault) — واحدة لكل mint
pub const CREATOR_FEE_VAULT_SEED: &[u8] = b"creator-fee-vault";

/// seed لخزينة الرسوم المُقسَّمة على عدة مستفيدين (Fee Splitter) — واحدة لكل mint
pub const FEE_SPLITTER_SEED: &[u8] = b"fee-splitter";
