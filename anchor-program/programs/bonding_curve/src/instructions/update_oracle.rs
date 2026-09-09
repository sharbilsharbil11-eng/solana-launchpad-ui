use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::Global;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateOracleAuthority<'info> {
    #[account(address = global.authority @ BondingCurveError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,

    /// CHECK: المفتاح العام الجديد لخادم الـ Oracle فقط
    pub new_oracle_authority: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<UpdateOracleAuthority>) -> Result<()> {
    let old = ctx.accounts.global.oracle_authority;
    ctx.accounts.global.oracle_authority = ctx.accounts.new_oracle_authority.key();

    msg!(
        "تم تحديث oracle_authority من {} إلى {}",
        old,
        ctx.accounts.global.oracle_authority
    );

    Ok(())
}
