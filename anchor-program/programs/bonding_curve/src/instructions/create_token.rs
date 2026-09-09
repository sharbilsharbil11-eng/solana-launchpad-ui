use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::identity::{encode_identity, normalize_identity};
use crate::state::{BondingCurve, CreatorFeeVault, CreatorType};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::instruction::AuthorityType;
// ⚠️ نقطة يجب التحقق منها بـ `cargo build`: مسار استيراد AuthorityType هذا
// (عبر anchor_spl::token::spl_token::...) هو النمط الشائع بنسخة anchor_spl
// 0.30.x المستخدمة بهذا المشروع، لكن مسارات إعادة تصدير spl_token اختلفت
// بين إصدارات anchor_spl تاريخيًا. لو صار خطأ compile هون تحديدًا، جرّب
// بدلها بـ `use spl_token::instruction::AuthorityType;` (يحتاج إضافة
// spl_token كـ dependency صريح بـ Cargo.toml) كبديل.
use anchor_spl::token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount};

/// ⚠️ مسار الإطلاق الذرّي (Atomic Launch) الموصى فيه: تعليمة واحدة تسوي كل شي
/// دفعة وحدة — الحساب على السلسلة إما ينفّذ بالكامل أو يفشل بالكامل، ما فيه
/// حالة وسط (مثلاً "اتصكت العملة بس المنحنى ما اتفعّل"). هذا يحل مكان تسلسل
/// الخطوات المنفصلة القديم (mint من الـ client → create_bonding_curve →
/// init_creator_fee_vault) اللي كان ثلاث معاملات منفصلة.
///
/// الـ decimals و creator_type و social_handle/creator_wallet لازم يوصلوا
/// كـ instruction args (مو accounts) عشان نقدر نستخدمهم بـ #[instruction(...)]
/// لاشتقاق قيود الحسابات (mint::decimals، seeds الهوية).
#[derive(Accounts)]
#[instruction(decimals: u8, total_supply: u64, creator_type: CreatorType, social_handle: Option<String>, creator_wallet: Option<Pubkey>)]
pub struct CreateToken<'info> {
    /// صاحب العملة — يدفع كل رسوم الإنشاء، وهو أيضًا صلاحية الـ mint/freeze
    /// المؤقتة (نلغيها بنفس هالتعليمة قبل ما تخلص)
    #[account(mut)]
    pub creator: Signer<'info>,

    /// حساب mint جديد بالكامل — العميل يولّد Keypair طازج ويوقّع فيه، مو PDA
    #[account(
        init,
        payer = creator,
        mint::decimals = decimals,
        mint::authority = creator,
        mint::freeze_authority = creator,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = BondingCurve::SIZE,
        seeds = [BONDING_CURVE_SEED, mint.key().as_ref()],
        bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    /// خزينة توكن المنحنى — كامل الـ 100% من العرض بينسك هون مباشرة، صفر حجز
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        space = CreatorFeeVault::SIZE,
        seeds = [CREATOR_FEE_VAULT_SEED, mint.key().as_ref()],
        bump
    )]
    pub creator_fee_vault: Account<'info, CreatorFeeVault>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateToken>,
    _decimals: u8,
    total_supply: u64,
    creator_type: CreatorType,
    social_handle: Option<String>,
    creator_wallet: Option<Pubkey>,
) -> Result<()> {
    // 1. سك كامل العرض (100%) مباشرة داخل خزينة المنحنى — بدون أي حجز أو خصم
    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.curve_token_vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        total_supply,
    )?;

    // 2. إلغاء صلاحية سك عملات إضافية للأبد (Revoke Mint Authority)
    token::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.creator.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        AuthorityType::MintTokens,
        None,
    )?;

    // 3. إلغاء صلاحية تجميد حسابات الحائزين للأبد (Revoke Freeze Authority)
    token::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.creator.to_account_info(),
                account_or_mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        AuthorityType::FreezeAccount,
        None,
    )?;

    // 4. تفعيل منحنى الإصدار فورًا بكامل العرض — قابل للتداول من نفس اللحظة
    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.mint = ctx.accounts.mint.key();
    bonding_curve.creator = ctx.accounts.creator.key();
    bonding_curve.virtual_token_reserves = INITIAL_VIRTUAL_TOKEN_RESERVES;
    bonding_curve.virtual_sol_reserves = INITIAL_VIRTUAL_SOL_RESERVES;
    bonding_curve.real_token_reserves = total_supply;
    bonding_curve.real_sol_reserves = 0;
    bonding_curve.token_total_supply = total_supply;
    bonding_curve.complete = false;
    bonding_curve.bump = ctx.bumps.bonding_curve;

    // 5. تفعيل خزينة أرباح Creator (Royalty المستمرة 1%) بنفس الذرّية
    let vault = &mut ctx.accounts.creator_fee_vault;
    vault.mint = ctx.accounts.mint.key();
    vault.creator_type = creator_type;
    vault.accrued_lamports = 0;
    vault.total_claimed_lamports = 0;
    vault.bump = ctx.bumps.creator_fee_vault;

    match creator_type {
        CreatorType::Wallet => {
            let w = creator_wallet.ok_or(BondingCurveError::MissingCreatorIdentity)?;
            let mut buf = [0u8; crate::state::MAX_IDENTITY_LEN];
            buf[..32].copy_from_slice(&w.to_bytes());
            vault.identity = buf;
            vault.identity_len = 0;
        }
        CreatorType::X | CreatorType::TikTok | CreatorType::Gmail => {
            let handle = social_handle.ok_or(BondingCurveError::MissingCreatorIdentity)?;
            let normalized = normalize_identity(creator_type, &handle)?;
            let (bytes, len) = encode_identity(&normalized);
            vault.identity = bytes;
            vault.identity_len = len;
        }
    }

    msg!(
        "✅ Token {} created atomically: 100% supply ({}) live on the curve, mint+freeze revoked, creator fee vault linked",
        bonding_curve.mint,
        total_supply
    );

    Ok(())
}
