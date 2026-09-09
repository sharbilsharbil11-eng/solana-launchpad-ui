use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::identity::{encode_identity, normalize_identity};
use crate::state::{BondingCurve, CreatorFeeVault, CreatorType};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitCreatorFeeVault<'info> {
    /// فقط منشئ العملة الأصلي (مسجَّل بـ bonding_curve.creator) يقدر يحدد/يربط هوية المطالبة
    #[account(mut, address = bonding_curve.creator)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [BONDING_CURVE_SEED, bonding_curve.mint.as_ref()],
        bump = bonding_curve.bump,
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(
        init,
        payer = creator,
        space = CreatorFeeVault::SIZE,
        seeds = [CREATOR_FEE_VAULT_SEED, bonding_curve.mint.as_ref()],
        bump
    )]
    pub creator_fee_vault: Account<'info, CreatorFeeVault>,

    pub system_program: Program<'info, System>,
}

/// creator_type يحدد أي حقل تستخدم:
///   - Wallet: مرّر creator_wallet = Some(pubkey)، اترك social_handle = None
///   - X / TikTok / Gmail: مرّر social_handle = Some("...")، اترك creator_wallet = None
pub fn handler(
    ctx: Context<InitCreatorFeeVault>,
    creator_type: CreatorType,
    social_handle: Option<String>,
    creator_wallet: Option<Pubkey>,
) -> Result<()> {
    let vault = &mut ctx.accounts.creator_fee_vault;
    vault.mint = ctx.accounts.bonding_curve.mint;
    vault.creator_type = creator_type;
    vault.accrued_lamports = 0;
    vault.total_claimed_lamports = 0;
    vault.bump = ctx.bumps.creator_fee_vault;

    match creator_type {
        CreatorType::Wallet => {
            let wallet = creator_wallet.ok_or(BondingCurveError::MissingCreatorIdentity)?;
            let mut buf = [0u8; crate::state::MAX_IDENTITY_LEN];
            buf[..32].copy_from_slice(&wallet.to_bytes());
            vault.identity = buf;
            vault.identity_len = 0; // غير مستخدم لنوع Wallet
            msg!(
                "تم ربط خزينة أرباح Creator للعملة {} بمحفظة {} مباشرة (بدون Oracle)",
                vault.mint,
                wallet
            );
        }
        CreatorType::X | CreatorType::TikTok | CreatorType::Gmail => {
            let handle = social_handle.ok_or(BondingCurveError::MissingCreatorIdentity)?;
            let normalized = normalize_identity(creator_type, &handle)?;
            let (bytes, len) = encode_identity(&normalized);
            vault.identity = bytes;
            vault.identity_len = len;
            msg!(
                "تم ربط خزينة أرباح Creator للعملة {} بحساب {:?}: {}",
                vault.mint,
                creator_type,
                normalized
            );
        }
    }

    Ok(())
}
