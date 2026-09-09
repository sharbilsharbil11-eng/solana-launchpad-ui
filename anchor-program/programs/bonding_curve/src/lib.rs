use anchor_lang::prelude::*;

pub mod constants;
pub mod curve_math;
pub mod errors;
pub mod identity;
pub mod instructions;
pub mod state;
pub mod username;

use instructions::*;
use state::CreatorType;

// Real program keypair generated for this deployment (see
// anchor-program/program-keypair.json, kept out of git — deploy with
// `anchor deploy --program-keypair program-keypair.json` so the on-chain
// address matches this id exactly).
declare_id!("4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb");

#[program]
pub mod bonding_curve {
    use super::*;

    /// يُستدعى مرة واحدة فقط من قبل مالك المنصة لإعداد الإعدادات العامة
    /// (Platform Fee + Creator Fee + محفظة الاستلام + المفتاح العام لخادم الـ Oracle الموثوق)
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_basis_points: u64,
        creator_fee_basis_points: u64,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, fee_basis_points, creator_fee_basis_points)
    }

    /// يدوّر مفتاح الـ Oracle (مثلاً عند تجديد بنية الـ backend أو لأسباب أمنية)
    pub fn update_oracle_authority(ctx: Context<UpdateOracleAuthority>) -> Result<()> {
        instructions::update_oracle::handler(ctx)
    }

    /// ⭐ المسار الموصى فيه (Atomic Launch): يسك العملة (100% من العرض)، يلغي
    /// صلاحيتي المينت والتجميد، يفعّل منحنى الإصدار، ويربط خزينة أرباح Creator —
    /// كل هذا بتعليمة واحدة تنفّذ بالكامل أو تفشل بالكامل. استدعِها من create.tsx
    /// (اختياريًا مع تعليمة buy بنفس المعاملة لتنفيذ Dev Buy ذرّيًا مع الإطلاق).
    pub fn create_token(
        ctx: Context<CreateToken>,
        decimals: u8,
        total_supply: u64,
        creator_type: CreatorType,
        social_handle: Option<String>,
        creator_wallet: Option<Pubkey>,
    ) -> Result<()> {
        instructions::create_token::handler(
            ctx,
            decimals,
            total_supply,
            creator_type,
            social_handle,
            creator_wallet,
        )
    }

    /// (مسار قديم متعدد الخطوات — لسا موجود لمرونة إضافية، بس create.tsx ما عاد يستخدمه)
    /// يُستدعى بعد صك عملة SPL لتفعيل منحنى الإصدار الخاص بها
    pub fn create_bonding_curve(ctx: Context<CreateBondingCurve>, token_amount: u64) -> Result<()> {
        instructions::create_pool::handler(ctx, token_amount)
    }

    /// (مسار قديم — لسا موجود، create.tsx ما عاد يستخدمه بعد create_token الذرّية)
    /// يربط هوية صانع العملة وينشئ خزينة أرباحه (Creator Fee Vault).
    /// creator_type يحدد المسار: Wallet (بدون Oracle) أو X/TikTok/Gmail (عبر Oracle لاحقًا).
    /// خطوة إلزامية بعد create_bonding_curve وقبل أي buy/sell.
    pub fn init_creator_fee_vault(
        ctx: Context<InitCreatorFeeVault>,
        creator_type: CreatorType,
        social_handle: Option<String>,
        creator_wallet: Option<Pubkey>,
    ) -> Result<()> {
        instructions::init_creator_fee_vault::handler(
            ctx,
            creator_type,
            social_handle,
            creator_wallet,
        )
    }

    /// شراء توكن مقابل SOL
    /// sol_amount: المبلغ بوحدة lamports
    /// min_tokens_out: الحد الأدنى المقبول من التوكن (حماية من الانزلاق السعري)
    pub fn buy(ctx: Context<Buy>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        instructions::buy::handler(ctx, sol_amount, min_tokens_out)
    }

    /// بيع توكن مقابل SOL
    /// token_amount: كمية التوكن المراد بيعها (بأصغر وحدة، مع مراعاة الـ decimals)
    /// min_sol_out: الحد الأدنى المقبول من SOL بوحدة lamports
    pub fn sell(ctx: Context<Sell>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        instructions::sell::handler(ctx, token_amount, min_sol_out)
    }

    /// يحجز حصة توكن (و/أو مبلغ SOL ثابت) باسم حساب X (تويتر) معيّن لم يربط محفظته بعد.
    /// x_username: اسم المستخدم (مع أو بدون @) — يُطبَّع تلقائيًا (lowercase) على العقد.
    pub fn reserve_claim(
        ctx: Context<ReserveClaim>,
        token_amount: u64,
        sol_amount: u64,
        x_username: String,
    ) -> Result<()> {
        instructions::reserve_claim::handler(ctx, token_amount, sol_amount, x_username)
    }

    /// يُطالِب بالحصة المحجوزة إلى محفظة recipient الحقيقية.
    /// يتطلب توقيعين: oracle (خادم الـ backend، بعد تحقق X OAuth) + recipient (محفظة المستفيد).
    pub fn claim_tokens(ctx: Context<ClaimTokens>, x_username: String) -> Result<()> {
        instructions::claim_tokens::handler(ctx, x_username)
    }

    /// يلغي حجزًا لم تتم المطالبة به بعد، ويعيد التوكن/SOL لمنشئ الحجز
    pub fn revoke_claim(ctx: Context<RevokeClaim>, x_username: String) -> Result<()> {
        instructions::revoke_claim::handler(ctx, x_username)
    }

    /// يسحب كامل الأرباح المتراكمة — مسار مباشر trustless لخزائن creator_type == Wallet
    /// فقط. صاحب المحفظة يوقّع بنفسه، بدون Oracle ولا backend إطلاقًا.
    pub fn claim_creator_fees_wallet(ctx: Context<ClaimCreatorFeesWallet>) -> Result<()> {
        instructions::claim_creator_fees_wallet::handler(ctx)
    }

    /// يسحب كامل الأرباح المتراكمة — مسار عبر Oracle لخزائن creator_type == X/TikTok/Gmail.
    /// نفس نموذج الثقة المستخدم بـ claim_tokens: توقيعين (oracle بعد تحقق OAuth + recipient).
    pub fn claim_creator_fees_social(
        ctx: Context<ClaimCreatorFeesSocial>,
        handle: String,
    ) -> Result<()> {
        instructions::claim_creator_fees_social::handler(ctx, handle)
    }
}
