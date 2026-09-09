use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::ClaimableAllocation;
use crate::username::{encode_username, normalize_username, username_seed};
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(token_amount: u64, sol_amount: u64, x_username: String)]
pub struct ReserveClaim<'info> {
    /// منشئ العملة (أو أي طرف يريد تخصيص حصة لحساب X معيّن)
    #[account(mut)]
    pub creator: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = ClaimableAllocation::SIZE,
        // ⚠️ .unwrap() هنا: لو الاسم غير صالح (رموز غير مسموحة، طول زائد) تفشل المعاملة فورًا
        // بخطأ عام بدل رسالة BondingCurveError مخصّصة. مقبول لأن reserve_claim غالبًا
        // يُستدعى من واجهة تتحقق من صيغة الاسم مسبقًا؛ فحص أدق ممكن إضافته لاحقًا.
        seeds = [CLAIM_SEED, mint.key().as_ref(), &username_seed(&normalize_username(&x_username).unwrap())],
        bump
    )]
    pub claimable: Account<'info, ClaimableAllocation>,

    /// خزينة التوكن الخاصة بهذا الحجز تحديدًا (PDA مملوك لحساب claimable)
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = claimable
    )]
    pub claim_token_vault: Account<'info, TokenAccount>,

    /// حساب توكن المُنشئ الذي تُسحب منه الكمية المحجوزة
    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<ReserveClaim>,
    token_amount: u64,
    sol_amount: u64,
    x_username: String,
) -> Result<()> {
    require!(
        token_amount > 0 || sol_amount > 0,
        BondingCurveError::NothingReserved
    );

    // نطبّع الاسم مرة ثانية هنا (بعد ما استُخدم فعليًا لاشتقاق seeds أعلاه) للتأكد والتخزين
    let normalized = normalize_username(&x_username)?;
    let (username_bytes, username_len) = encode_username(&normalized);

    // 1. نقل التوكن من محفظة المُنشئ إلى خزينة هذا الحجز
    if token_amount > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.claim_token_vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            token_amount,
        )?;
    }

    // 2. (اختياري) تحويل مبلغ SOL ثابت يُحجز مع الحصة — يمثل مثلاً دفعة مقدّمة من الرسوم
    if sol_amount > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.claimable.to_account_info(),
                },
            ),
            sol_amount,
        )?;
    }

    let claimable = &mut ctx.accounts.claimable;
    claimable.mint = ctx.accounts.mint.key();
    claimable.creator = ctx.accounts.creator.key();
    claimable.x_username = username_bytes;
    claimable.x_username_len = username_len;
    claimable.token_amount = token_amount;
    claimable.sol_amount = sol_amount;
    claimable.claimed = false;
    claimable.created_at = Clock::get()?.unix_timestamp;
    claimable.bump = ctx.bumps.claimable;

    msg!(
        "تم حجز {} توكن و {} lamports SOL باسم @{} بانتظار المطالبة",
        token_amount,
        sol_amount,
        normalized
    );

    Ok(())
}
