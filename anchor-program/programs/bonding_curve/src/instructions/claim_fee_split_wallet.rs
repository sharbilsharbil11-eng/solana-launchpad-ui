use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::{CreatorType, FeeSplitter};
use anchor_lang::prelude::*;

/// مطالبة مباشرة trustless بحصة مستفيد واحد بمصفوفة الـ Fee Splitter —
/// ينطبق فقط على مستفيدين من creator_type == Wallet. بدون Oracle ولا backend
/// إطلاقًا؛ صاحب المحفظة المسجَّلة بهاي الحصة تحديدًا يوقّع ويسحب حصته بنفسه،
/// باستقلالية تامة عن باقي المستفيدين بنفس المصفوفة.
#[derive(Accounts)]
#[instruction(recipient_index: u8)]
pub struct ClaimFeeSplitWallet<'info> {
    /// محفظة المستفيد — لازم تطابق fee_splitter.recipients[recipient_index].identity_pubkey() بالضبط
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [FEE_SPLITTER_SEED, fee_splitter.mint.as_ref()],
        bump = fee_splitter.bump,
    )]
    pub fee_splitter: Account<'info, FeeSplitter>,
}

pub fn handler(ctx: Context<ClaimFeeSplitWallet>, recipient_index: u8) -> Result<()> {
    let splitter = &ctx.accounts.fee_splitter;
    require!(
        (recipient_index as usize) < (splitter.recipient_count as usize),
        BondingCurveError::InvalidFeeSplitRecipientIndex
    );

    let entry = &splitter.recipients[recipient_index as usize];
    require!(
        entry.creator_type == CreatorType::Wallet,
        BondingCurveError::InvalidCreatorType
    );
    require!(
        entry.identity_pubkey() == ctx.accounts.recipient.key(),
        BondingCurveError::WalletIdentityMismatch
    );

    let amount = entry.accrued_lamports;
    require!(amount > 0, BondingCurveError::NothingToClaim);

    let splitter_info = ctx.accounts.fee_splitter.to_account_info();
    **splitter_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

    let splitter = &mut ctx.accounts.fee_splitter;
    let entry = &mut splitter.recipients[recipient_index as usize];
    entry.accrued_lamports = 0;
    entry.total_claimed_lamports = entry
        .total_claimed_lamports
        .checked_add(amount)
        .ok_or(BondingCurveError::MathOverflow)?;

    msg!(
        "✅ تمت المطالبة المباشرة بحصة Fee Splitter #{}: {} lamports بواسطة {}",
        recipient_index,
        amount,
        ctx.accounts.recipient.key()
    );

    Ok(())
}
