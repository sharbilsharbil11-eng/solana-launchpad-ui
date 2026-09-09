use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::{ClaimableAllocation, Global};
use crate::username::{normalize_username, username_seed};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(x_username: String)]
pub struct ClaimTokens<'info> {
    /// خادم الـ Oracle الموثوق — يوقّع فقط بعد ما يتحقق من هوية صاحب حساب X عبر OAuth
    /// ويتأكد إن recipient هو فعلاً من طلب الـ Claim بجلسة موثّقة. هذا هو مصدر الثقة الوحيد
    /// في هذا المسار (بعكس نظام الروابط السرية trustless).
    #[account(constraint = oracle.key() == global.oracle_authority @ BondingCurveError::InvalidOracle)]
    pub oracle: Signer<'info>,

    /// محفظة المستفيد الحقيقية المتصلة الآن — تدفع الرسوم/الإيجار وتستلم الأموال
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(seeds = [GLOBAL_SEED], bump = global.bump)]
    pub global: Account<'info, Global>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, mint.key().as_ref(), &username_seed(&normalize_username(&x_username).unwrap())],
        bump = claimable.bump,
        has_one = mint,
    )]
    pub claimable: Account<'info, ClaimableAllocation>,

    #[account(mut)]
    pub claim_token_vault: Account<'info, TokenAccount>,

    /// حساب توكن المستفيد — يُنشأ تلقائيًا إذا لم يكن موجودًا
    #[account(
        init_if_needed,
        payer = recipient,
        associated_token::mint = mint,
        associated_token::authority = recipient
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimTokens>, _x_username: String) -> Result<()> {
    require!(!ctx.accounts.claimable.claimed, BondingCurveError::AlreadyClaimed);

    let mint_key = ctx.accounts.mint.key();
    let claimable_bump = ctx.accounts.claimable.bump;
    let username_hash = username_seed(&ctx.accounts.claimable.username_string());
    let token_amount = ctx.accounts.claimable.token_amount;
    let sol_amount = ctx.accounts.claimable.sol_amount;

    // 1. تحويل التوكن المحجوز من الخزينة إلى محفظة المستفيد (يوقّع PDA الحجز عبر seeds)
    if token_amount > 0 {
        let signer_seeds: &[&[&[u8]]] = &[&[
            CLAIM_SEED,
            mint_key.as_ref(),
            &username_hash,
            &[claimable_bump],
        ]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.claim_token_vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.claimable.to_account_info(),
                },
                signer_seeds,
            ),
            token_amount,
        )?;
    }

    // 2. تحويل مبلغ SOL المحجوز (إن وجد) مباشرة من حساب claimable إلى المستفيد
    if sol_amount > 0 {
        let claimable_info = ctx.accounts.claimable.to_account_info();
        **claimable_info.try_borrow_mut_lamports()? -= sol_amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += sol_amount;
    }

    let claimable = &mut ctx.accounts.claimable;
    claimable.claimed = true;

    msg!(
        "✅ تمت المطالبة بـ {} توكن و {} lamports SOL بواسطة {} (@{})",
        token_amount,
        sol_amount,
        ctx.accounts.recipient.key(),
        claimable.username_string()
    );

    Ok(())
}
