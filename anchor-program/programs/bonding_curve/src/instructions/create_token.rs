use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::identity::{encode_identity, normalize_identity};
use crate::state::{
    BondingCurve, CreatorType, FeeSplitRecipient, FeeSplitRecipientInput, FeeSplitter,
    CONTRIBUTOR_MAX_BPS, FEE_SPLIT_TOTAL_BPS, MAX_FEE_SPLIT_RECIPIENTS, PRIMARY_RECIPIENT_MIN_BPS,
};
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
/// الـ decimals و recipients (مصفوفة توزيع الرسوم) لازم يوصلوا كـ instruction
/// args (مو accounts) عشان نقدر نستخدمهم بـ #[instruction(...)] لاشتقاق قيود
/// الحسابات (mint::decimals، seeds الهوية).
#[derive(Accounts)]
#[instruction(decimals: u8, total_supply: u64, recipients: Vec<FeeSplitRecipientInput>)]
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

    /// خزينة الرسوم المُقسَّمة (Fee Splitter) — بديل CreatorFeeVault، تدعم حتى
    /// 5 مستفيدين بمصفوفة واحدة بدل خزينة منفصلة لكل واحد
    #[account(
        init,
        payer = creator,
        space = FeeSplitter::SIZE,
        seeds = [FEE_SPLITTER_SEED, mint.key().as_ref()],
        bump
    )]
    pub fee_splitter: Account<'info, FeeSplitter>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateToken>,
    _decimals: u8,
    total_supply: u64,
    recipients: Vec<FeeSplitRecipientInput>,
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

    // 5. تفعيل خزينة الرسوم المُقسَّمة (Fee Splitter) — مستفيد أساسي واحد
    // إلزامي (recipients[0]، هوية صانع العملة أو حساب إكس اللي ربطها فيه)
    // ياخد 50% كحد أدنى دايمًا، + لحد 5 مساهمين اختياريين كل واحد محدود
    // بحد أقصى 10%. حصة كل واحد بتتجمع بشكل مستقل تمامًا عن الباقي مع كل
    // صفقة buy/sell. هاي الضمانة مفروضة هون بالعقد نفسه — مش بس بواجهة
    // المستخدم — حتى لو حدا استدعى create_token مباشرة بدون المرور بالواجهة.
    require!(
        !recipients.is_empty() && recipients.len() <= MAX_FEE_SPLIT_RECIPIENTS,
        BondingCurveError::InvalidFeeSplitRecipientCount
    );
    let bps_sum: u32 = recipients.iter().map(|r| r.bps as u32).sum();
    require!(
        bps_sum == FEE_SPLIT_TOTAL_BPS as u32,
        BondingCurveError::InvalidFeeSplitTotal
    );
    require!(
        recipients[0].bps >= PRIMARY_RECIPIENT_MIN_BPS,
        BondingCurveError::PrimaryRecipientShareTooLow
    );
    for contributor in recipients.iter().skip(1) {
        require!(
            contributor.bps <= CONTRIBUTOR_MAX_BPS,
            BondingCurveError::ContributorShareTooHigh
        );
    }

    let splitter = &mut ctx.accounts.fee_splitter;
    splitter.mint = ctx.accounts.mint.key();
    splitter.recipient_count = recipients.len() as u8;
    splitter.bump = ctx.bumps.fee_splitter;

    for (i, input) in recipients.iter().enumerate() {
        let mut entry = FeeSplitRecipient {
            creator_type: input.creator_type,
            bps: input.bps,
            ..Default::default()
        };
        match input.creator_type {
            CreatorType::Wallet => {
                let w = input
                    .wallet
                    .ok_or(BondingCurveError::MissingCreatorIdentity)?;
                let mut buf = [0u8; crate::state::MAX_IDENTITY_LEN];
                buf[..32].copy_from_slice(&w.to_bytes());
                entry.identity = buf;
                entry.identity_len = 0;
            }
            CreatorType::X | CreatorType::TikTok | CreatorType::Gmail => {
                let handle = input
                    .social_handle
                    .as_ref()
                    .ok_or(BondingCurveError::MissingCreatorIdentity)?;
                let normalized = normalize_identity(input.creator_type, handle)?;
                let (bytes, len) = encode_identity(&normalized);
                entry.identity = bytes;
                entry.identity_len = len;
            }
        }
        splitter.recipients[i] = entry;
    }

    msg!(
        "✅ Token {} created atomically: 100% supply ({}) live on the curve, mint+freeze revoked, fee splitter linked ({} recipients)",
        bonding_curve.mint,
        total_supply,
        splitter.recipient_count
    );

    Ok(())
}
