use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::identity::normalize_identity;
use crate::state::{CreatorFeeVault, CreatorType, Global};
use anchor_lang::prelude::*;

/// مطالبة عبر Oracle: تنطبق على خزائن creator_type == X / TikTok / Gmail.
/// نفس نموذج الثقة المستخدم بـ claim_tokens: الـ backend يتحقق من هوية المستخدم عبر
/// OAuth المنصة المعنية، ثم يوقّع نيابة عن النظام لإثبات هذا التحقق.
#[derive(Accounts)]
#[instruction(handle: String)]
pub struct ClaimCreatorFeesSocial<'info> {
    /// خادم الـ Oracle الموثوق — يوقّع فقط بعد ما يتحقق من هوية صاحب الحساب عبر OAuth المنصة المعنية
    #[account(constraint = oracle.key() == global.oracle_authority @ BondingCurveError::InvalidOracle)]
    pub oracle: Signer<'info>,

    /// محفظة صاحب الحساب الحقيقية المتصلة الآن — تستلم الأرباح
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,

    #[account(
        mut,
        seeds = [CREATOR_FEE_VAULT_SEED, creator_fee_vault.mint.as_ref()],
        bump = creator_fee_vault.bump,
    )]
    pub creator_fee_vault: Account<'info, CreatorFeeVault>,
}

pub fn handler(ctx: Context<ClaimCreatorFeesSocial>, handle: String) -> Result<()> {
    let vault = &ctx.accounts.creator_fee_vault;

    require!(
        matches!(
            vault.creator_type,
            CreatorType::X | CreatorType::TikTok | CreatorType::Gmail
        ),
        BondingCurveError::InvalidCreatorType
    );

    let normalized = normalize_identity(vault.creator_type, &handle)?;
    require!(
        vault.identity_string() == normalized,
        BondingCurveError::CreatorUsernameMismatch
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
        "✅ تمت المطالبة (عبر Oracle) بأرباح Creator: {} lamports بواسطة {} ({})",
        amount,
        ctx.accounts.recipient.key(),
        normalized
    );

    Ok(())
}
