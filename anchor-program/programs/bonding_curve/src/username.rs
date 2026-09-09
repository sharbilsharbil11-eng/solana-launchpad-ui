use crate::errors::BondingCurveError;
use crate::state::MAX_USERNAME_LEN;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;

/// يطبّع اسم مستخدم X: يحذف @ البادئة، يحوّل لأحرف صغيرة، يزيل الفراغات الطرفية.
/// يجب استدعاء نفس هذه الدالة بالضبط عند الحجز والمطالبة والإلغاء حتى يتطابق اشتقاق PDA.
pub fn normalize_username(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_start_matches('@').to_lowercase();
    require!(!trimmed.is_empty(), BondingCurveError::InvalidUsername);
    require!(
        trimmed.len() <= MAX_USERNAME_LEN,
        BondingCurveError::UsernameTooLong
    );
    require!(
        trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        BondingCurveError::InvalidUsername
    );
    Ok(trimmed)
}

/// يحوّل اسم المستخدم المطبَّع إلى مصفوفة بايتات ثابتة الطول (مبطَّنة بأصفار) لتخزينها على الحساب
pub fn encode_username(normalized: &str) -> ([u8; MAX_USERNAME_LEN], u8) {
    let mut buf = [0u8; MAX_USERNAME_LEN];
    let bytes = normalized.as_bytes();
    buf[..bytes.len()].copy_from_slice(bytes);
    (buf, bytes.len() as u8)
}

/// يحسب seed الاشتقاق (32 بايت) من اسم المستخدم المطبَّع — يُستخدم كجزء من seeds الخاصة بـ PDA
pub fn username_seed(normalized: &str) -> [u8; 32] {
    hashv(&[normalized.as_bytes()]).to_bytes()
}
