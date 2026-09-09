use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::ClaimableAllocation;
use crate::username::{normalize_username, username_seed};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
#[instruction(x_username: String)]
pub struct RevokeClaim<'info> {
    /// فقط منشئ الحجز الأصلي يقدر يلغيه
    #[account(mut, address = claimable.creator @ BondingCurveError::Unauthorized)]
    pub creator: Signer<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [CLAIM_SEED, mint.key().as_ref(), &username_seed(&normalize_username(&x_username).unwrap())],
        bump = claimable.bump,
        has_one = mint,
        close = creator // يُغلق الحساب وتُعاد رواسب الإيجار (rent) + أي SOL محجوز للمُنشئ
    )]
    pub claimable: Account<'info, ClaimableAllocation>,

    #[account(mut)]
    pub claim_token_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key(),
        constraint = creator_token_account.owner == creator.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RevokeClaim>, _x_username: String) -> Result<()> {
    require!(
        !ctx.accounts.claimable.claimed,
        BondingCurveError::CannotRevokeClaimed
    );

    let mint_key = ctx.accounts.mint.key();
    let username_hash = username_seed(&ctx.accounts.claimable.username_string());
    let bump = ctx.accounts.claimable.bump;
    let token_amount = ctx.accounts.claimable.token_amount;

    let signer_seeds: &[&[&[u8]]] = &[&[
        CLAIM_SEED,
        mint_key.as_ref(),
        &username_hash,
        &[bump],
    ]];

    // إرجاع التوكن المحجوز لمحفظة المُنشئ قبل إغلاق الخزينة
    if token_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.claim_token_vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.claimable.to_account_info(),
                },
                signer_seeds,
            ),
            token_amount,
        )?;
    }

    // إغلاق خزينة التوكن الخاصة بالحجز (أصبحت فارغة الآن) واسترجاع الإيجار للمُنشئ
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.claim_token_vault.to_account_info(),
            destination: ctx.accounts.creator.to_account_info(),
            authority: ctx.accounts.claimable.to_account_info(),
        },
        signer_seeds,
    ))?;

    // ملاحظة: أي SOL محجوز (claimable.sol_amount) يُعاد تلقائيًا للمُنشئ ضمن
    // إغلاق حساب claimable نفسه (close = creator) لأنه جزء من رصيد lamports العام للحساب

    msg!("تم إلغاء الحجز وإرجاع {} توكن للمُنشئ", token_amount);

    Ok(())
}
