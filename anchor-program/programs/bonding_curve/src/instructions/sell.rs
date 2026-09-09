use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::{BondingCurve, CreatorFeeVault, Global};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [BONDING_CURVE_SEED, mint.key().as_ref()],
        bump = bonding_curve.bump,
        has_one = mint
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(mut)]
    pub curve_token_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.mint == mint.key(),
        constraint = seller_token_account.owner == seller.key()
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: محفظة صاحب المنصة — تستلم الـ Platform Fee، يتحقق منها بمطابقتها مع global.fee_recipient
    #[account(mut, constraint = fee_recipient.key() == global.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    /// خزينة أرباح صانع العملة — الـ Creator Fee يتجمّع هنا بدل تحويل مباشر
    #[account(
        mut,
        seeds = [CREATOR_FEE_VAULT_SEED, mint.key().as_ref()],
        bump = creator_fee_vault.bump,
    )]
    pub creator_fee_vault: Account<'info, CreatorFeeVault>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Sell>, token_amount: u64, min_sol_out: u64) -> Result<()> {
    let bonding_curve_info = ctx.accounts.bonding_curve.to_account_info();
    let bonding_curve = &ctx.accounts.bonding_curve;
    require!(!bonding_curve.complete, BondingCurveError::CurveComplete);

    let result = bonding_curve.compute_sell(
        token_amount,
        ctx.accounts.global.fee_basis_points,
        ctx.accounts.global.creator_fee_basis_points,
    )?;
    require!(
        result.sol_out_after_fee >= min_sol_out,
        BondingCurveError::SlippageExceeded
    );

    let total_out = result
        .sol_out_after_fee
        .checked_add(result.platform_fee)
        .and_then(|v| v.checked_add(result.creator_fee))
        .ok_or(BondingCurveError::MathOverflow)?;

    // تأكد أن خزينة المنحنى تحتفظ برصيد كافٍ للإيجار (rent-exempt) بعد السحب
    let rent_exempt_minimum = Rent::get()?.minimum_balance(BondingCurve::SIZE);
    require!(
        bonding_curve_info.lamports()
            >= total_out
                .checked_add(rent_exempt_minimum)
                .ok_or(BondingCurveError::MathOverflow)?,
        BondingCurveError::InsufficientTokenReserves
    );

    // 1. تحويل التوكن من البائع إلى خزينة المنحنى
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.seller_token_account.to_account_info(),
                to: ctx.accounts.curve_token_vault.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        token_amount,
    )?;

    // 2. تحويل SOL من خزينة المنحنى: للبائع + Platform Fee فورًا + Creator Fee لخزينة الـ escrow
    // ملاحظة: bonding_curve حساب بيانات مملوك لبرنامجنا، فنعدّل lamports مباشرة
    **bonding_curve_info.try_borrow_mut_lamports()? -= total_out;
    **ctx
        .accounts
        .seller
        .to_account_info()
        .try_borrow_mut_lamports()? += result.sol_out_after_fee;
    **ctx
        .accounts
        .fee_recipient
        .to_account_info()
        .try_borrow_mut_lamports()? += result.platform_fee;
    **ctx
        .accounts
        .creator_fee_vault
        .to_account_info()
        .try_borrow_mut_lamports()? += result.creator_fee;

    if result.creator_fee > 0 {
        let vault = &mut ctx.accounts.creator_fee_vault;
        vault.accrued_lamports = vault
            .accrued_lamports
            .checked_add(result.creator_fee)
            .ok_or(BondingCurveError::MathOverflow)?;
    }

    // 3. تحديث حالة المنحنى
    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.virtual_sol_reserves = bonding_curve
        .virtual_sol_reserves
        .checked_sub(result.sol_out_after_fee)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.virtual_token_reserves = bonding_curve
        .virtual_token_reserves
        .checked_add(token_amount)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.real_sol_reserves = bonding_curve
        .real_sol_reserves
        .checked_sub(result.sol_out_after_fee)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.real_token_reserves = bonding_curve
        .real_token_reserves
        .checked_add(token_amount)
        .ok_or(BondingCurveError::MathOverflow)?;

    msg!(
        "بيع: {} توكن مقابل {} lamports SOL (platform fee: {}, creator fee متراكم بالخزينة: {})",
        token_amount,
        result.sol_out_after_fee,
        result.platform_fee,
        result.creator_fee
    );

    Ok(())
}
