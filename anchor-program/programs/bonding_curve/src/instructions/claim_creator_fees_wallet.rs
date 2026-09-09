use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::{CreatorFeeVault, CreatorType};
use anchor_lang::prelude::*;

/// مطالبة مباشرة وtrustless بالكامل: تنطبق فقط على خزائن creator_type == Wallet.
/// لا يوجد أي حساب Oracle هنا — صاحب المحفظة المسجَّلة يوقّع بنفسه ويسحب أرباحه مباشرة،
/// بدون أي وسيط أو خادم backend.
#[derive(Accounts)]
pub struct ClaimCreatorFeesWallet<'info> {
    /// محفظة صاحب العملة — لازم تطابق creator_fee_vault.identity_pubkey() بالضبط
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [CREATOR_FEE_VAULT_SEED, creator_fee_vault.mint.as_ref()],
        bump = creator_fee_vault.bump,
    )]
    pub creator_fee_vault: Account<'info, CreatorFeeVault>,
}

pub fn handler(ctx: Context<ClaimCreatorFeesWallet>) -> Result<()> {
    let vault = &ctx.accounts.creator_fee_vault;

    require!(
        vault.creator_type == CreatorType::Wallet,
        BondingCurveError::InvalidCreatorType
    );
    require!(
        vault.identity_pubkey() == ctx.accounts.recipient.key(),
        BondingCurveError::WalletIdentityMismatch
    );

    let amount = vault.accrued_lamports;
    require!(amount > 0, BondingCurveError::NothingToClaim);

    let vault_info = ctx.accounts.creator_fee_vault.to_account_info();
    **vault_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

    let vault = &mut ctx.accounts.creator_fee_vault;
    vault.accrued_lamports = 0;
    vault.total_claimed_lamports = vault
        .total_claimed_lamports
        .checked_add(amount)
        .ok_or(BondingCurveError::MathOverflow)?;

    msg!(
        "✅ تمت المطالبة المباشرة بأرباح Creator: {} lamports بواسطة {}",
        amount,
        ctx.accounts.recipient.key()
    );

    Ok(())
}
