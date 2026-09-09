use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::Global;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Global::SIZE,
        seeds = [GLOBAL_SEED],
        bump
    )]
    pub global: Account<'info, Global>,

    /// CHECK: محفظتك أنت (صاحب المنصة) — تستلم الـ Platform Fee. ضع عنوان محفظتك
    /// الحقيقية هنا وقت استدعاء هذه التعليمة (من سكربت النشر/التهيئة)، مو بالكود.
    pub fee_recipient: UncheckedAccount<'info>,

    /// CHECK: المفتاح العام لخادم الـ Oracle فقط (السر الخاص يبقى محفوظًا في الـ backend، ليس هنا)
    pub oracle_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    fee_basis_points: u64,
    creator_fee_basis_points: u64,
) -> Result<()> {
    require!(fee_basis_points < 10_000, BondingCurveError::InvalidFeeBasisPoints);
    require!(creator_fee_basis_points < 10_000, BondingCurveError::InvalidFeeBasisPoints);
    // حماية إضافية: مجموع العمولتين ما يقدر يتجاوز 100% من قيمة الصفقة
    require!(
        fee_basis_points + creator_fee_basis_points < 10_000,
        BondingCurveError::InvalidFeeBasisPoints
    );

    let global = &mut ctx.accounts.global;
    global.authority = ctx.accounts.authority.key();
    global.fee_recipient = ctx.accounts.fee_recipient.key();
    global.oracle_authority = ctx.accounts.oracle_authority.key();
    global.fee_basis_points = fee_basis_points;
    global.creator_fee_basis_points = creator_fee_basis_points;
    global.bump = ctx.bumps.global;

    Ok(())
}
