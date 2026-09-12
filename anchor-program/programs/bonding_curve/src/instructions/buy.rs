use crate::constants::*;
use crate::errors::BondingCurveError;
use crate::state::{BondingCurve, FeeSplitter, Global};
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

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
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: محفظة صاحب المنصة — تستلم الـ Platform Fee، يتحقق منها بمطابقتها مع global.fee_recipient
    #[account(mut, constraint = fee_recipient.key() == global.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,

    /// خزينة الرسوم المُقسَّمة (Fee Splitter) — الـ Creator Fee يتجمّع هنا كـ escrow
    /// بدل أي تحويل مباشر لمحفظة، ويتوزّع داخليًا على حتى 5 مستفيدين حسب حصة كل
    /// واحد (bps). محدا يسحب حصته إلا هو، عبر claim_fee_split_wallet (أو Oracle
    /// لاحقًا للأنواع الاجتماعية). لازم تكون منشأة مسبقًا عبر create_token.
    #[account(
        mut,
        seeds = [FEE_SPLITTER_SEED, mint.key().as_ref()],
        bump = fee_splitter.bump,
    )]
    pub fee_splitter: Account<'info, FeeSplitter>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Buy>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
    let bonding_curve = &ctx.accounts.bonding_curve;
    require!(!bonding_curve.complete, BondingCurveError::CurveComplete);

    let result = bonding_curve.compute_buy(
        sol_amount,
        ctx.accounts.global.fee_basis_points,
        ctx.accounts.global.creator_fee_basis_points,
    )?;
    require!(
        result.tokens_out >= min_tokens_out,
        BondingCurveError::SlippageExceeded
    );

    // 1. تحويل SOL من المشتري إلى خزينة المنحنى (بعد خصم العمولتين)
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.bonding_curve.to_account_info(),
            },
        ),
        result.sol_in_after_fee,
    )?;

    // 2. Platform Fee → محفظة صاحب المنصة (تحويل فوري كالمعتاد)
    if result.platform_fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.fee_recipient.to_account_info(),
                },
            ),
            result.platform_fee,
        )?;
    }

    // 3. Creator Fee → خزينة الـ escrow (مش تحويل مباشر) — تتوزّع فورًا على كل
    // مستفيدي مصفوفة الـ Fee Splitter حسب حصة كل واحد، وتتراكم لحد ما يطالب فيها
    if result.creator_fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.fee_splitter.to_account_info(),
                },
            ),
            result.creator_fee,
        )?;
        ctx.accounts.fee_splitter.distribute(result.creator_fee)?;
    }

    // 4. تحويل التوكن من خزينة المنحنى إلى محفظة المشتري (يوقّع PDA المنحنى عبر seeds)
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        BONDING_CURVE_SEED,
        mint_key.as_ref(),
        &[bonding_curve.bump],
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.curve_token_vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.bonding_curve.to_account_info(),
            },
            signer_seeds,
        ),
        result.tokens_out,
    )?;

    // 5. تحديث حالة المنحنى
    let bonding_curve = &mut ctx.accounts.bonding_curve;
    bonding_curve.virtual_sol_reserves = bonding_curve
        .virtual_sol_reserves
        .checked_add(result.sol_in_after_fee)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.virtual_token_reserves = bonding_curve
        .virtual_token_reserves
        .checked_sub(result.tokens_out)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.real_sol_reserves = bonding_curve
        .real_sol_reserves
        .checked_add(result.sol_in_after_fee)
        .ok_or(BondingCurveError::MathOverflow)?;
    bonding_curve.real_token_reserves = bonding_curve
        .real_token_reserves
        .checked_sub(result.tokens_out)
        .ok_or(BondingCurveError::MathOverflow)?;

    if bonding_curve.real_sol_reserves >= CURVE_COMPLETE_SOL_THRESHOLD {
        bonding_curve.complete = true;
        msg!("🎓 المنحنى اكتمل! جاهز للترحيل إلى بركة سيولة دائمة");
    }

    msg!(
        "شراء: {} lamports SOL مقابل {} توكن (platform fee: {}, creator fee متراكم بالخزينة: {})",
        result.sol_in_after_fee,
        result.tokens_out,
        result.platform_fee,
        result.creator_fee
    );

    Ok(())
}
