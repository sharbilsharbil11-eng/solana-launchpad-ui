use crate::errors::BondingCurveError;
use crate::state::BondingCurve;
use anchor_lang::prelude::*;

pub struct BuyResult {
    pub tokens_out: u64,
    pub sol_in_after_fee: u64,
    pub platform_fee: u64,
    pub creator_fee: u64,
}

pub struct SellResult {
    pub sol_out_after_fee: u64,
    pub platform_fee: u64,
    pub creator_fee: u64,
}

/// يحسب مبلغ من basis points بأمان (بدون overflow) — مستخدمة لكلا العمولتين
fn fee_amount(amount: u64, basis_points: u64) -> Result<u64> {
    Ok((amount as u128)
        .checked_mul(basis_points as u128)
        .ok_or(BondingCurveError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(BondingCurveError::MathOverflow)? as u64)
}

impl BondingCurve {
    /// يحسب كمية التوكن التي سيحصل عليها المشتري مقابل sol_in، بعد خصم عمولتين
    /// منفصلتين (Platform Fee + Creator Fee) من المبلغ قبل ما يدخل المنحنى.
    /// باستخدام صيغة "الضرب الثابت" k = x * y (نفس آلية Uniswap v2 / pump.fun)
    pub fn compute_buy(
        &self,
        sol_in: u64,
        platform_fee_bps: u64,
        creator_fee_bps: u64,
    ) -> Result<BuyResult> {
        require!(sol_in > 0, BondingCurveError::InvalidSolAmount);

        let platform_fee = fee_amount(sol_in, platform_fee_bps)?;
        let creator_fee = fee_amount(sol_in, creator_fee_bps)?;

        let sol_in_after_fee = sol_in
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(BondingCurveError::MathOverflow)?;

        let k = (self.virtual_sol_reserves as u128)
            .checked_mul(self.virtual_token_reserves as u128)
            .ok_or(BondingCurveError::MathOverflow)?;

        let new_virtual_sol = (self.virtual_sol_reserves as u128)
            .checked_add(sol_in_after_fee as u128)
            .ok_or(BondingCurveError::MathOverflow)?;

        let new_virtual_tokens = k
            .checked_div(new_virtual_sol)
            .ok_or(BondingCurveError::MathOverflow)?;

        let tokens_out = (self.virtual_token_reserves as u128)
            .checked_sub(new_virtual_tokens)
            .ok_or(BondingCurveError::MathOverflow)? as u64;

        require!(
            tokens_out <= self.real_token_reserves,
            BondingCurveError::InsufficientTokenReserves
        );

        Ok(BuyResult {
            tokens_out,
            sol_in_after_fee,
            platform_fee,
            creator_fee,
        })
    }

    /// يحسب كمية SOL التي سيحصل عليها البائع مقابل token_in، ثم يخصم عمولتين
    /// منفصلتين (Platform Fee + Creator Fee) من الناتج قبل تحويله للبائع.
    pub fn compute_sell(
        &self,
        token_in: u64,
        platform_fee_bps: u64,
        creator_fee_bps: u64,
    ) -> Result<SellResult> {
        require!(token_in > 0, BondingCurveError::InvalidTokenAmount);

        let k = (self.virtual_sol_reserves as u128)
            .checked_mul(self.virtual_token_reserves as u128)
            .ok_or(BondingCurveError::MathOverflow)?;

        let new_virtual_tokens = (self.virtual_token_reserves as u128)
            .checked_add(token_in as u128)
            .ok_or(BondingCurveError::MathOverflow)?;

        let new_virtual_sol = k
            .checked_div(new_virtual_tokens)
            .ok_or(BondingCurveError::MathOverflow)?;

        let sol_out = (self.virtual_sol_reserves as u128)
            .checked_sub(new_virtual_sol)
            .ok_or(BondingCurveError::MathOverflow)? as u64;

        require!(
            sol_out <= self.real_sol_reserves,
            BondingCurveError::InsufficientTokenReserves
        );

        let platform_fee = fee_amount(sol_out, platform_fee_bps)?;
        let creator_fee = fee_amount(sol_out, creator_fee_bps)?;

        let sol_out_after_fee = sol_out
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(creator_fee))
            .ok_or(BondingCurveError::MathOverflow)?;

        Ok(SellResult {
            sol_out_after_fee,
            platform_fee,
            creator_fee,
        })
    }
}
