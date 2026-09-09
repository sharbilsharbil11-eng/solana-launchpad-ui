use crate::constants::*;
use crate::state::BondingCurve;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct CreateBondingCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = BondingCurve::SIZE,
        seeds = [BONDING_CURVE_SEED, mint.key().as_ref()],
        bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    /// خزينة التوكن المملوكة للمنحنى (PDA) — هنا تُحفظ العملات المتاحة للبيع
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_vault: Account<'info, TokenAccount>,

    /// حساب توكن المُنشئ الذي يحمل العرض الكامل بعد الصك (من صفحة create.tsx)
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

pub fn handler(ctx: Context<CreateBondingCurve>, token_amount: u64) -> Result<()> {
    // تحويل كامل العرض (أو الكمية المحددة) من محفظة المُنشئ إلى خزينة المنحنى
    let cpi_accounts = Transfer {
        from: ctx.accounts.creator_token_account.to_account_info(),
        to: ctx.accounts.curve_token_vault.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, token_amount)?;

    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.mint = ctx.accounts.mint.key();
    bonding_curve.creator = ctx.accounts.creator.key();
    bonding_curve.virtual_token_reserves = INITIAL_VIRTUAL_TOKEN_RESERVES;
    bonding_curve.virtual_sol_reserves = INITIAL_VIRTUAL_SOL_RESERVES;
    bonding_curve.real_token_reserves = token_amount;
    bonding_curve.real_sol_reserves = 0;
    bonding_curve.token_total_supply = token_amount;
    bonding_curve.complete = false;
    bonding_curve.bump = ctx.bumps.bonding_curve;

    msg!(
        "تم إنشاء منحنى إصدار للعملة {} بعرض {} توكن",
        bonding_curve.mint,
        token_amount
    );

    Ok(())
}
