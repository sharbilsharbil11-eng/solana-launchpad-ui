use crate::errors::BondingCurveError;
use crate::state::{CreatorType, MAX_IDENTITY_LEN};
use anchor_lang::prelude::*;

/// يطبّع مقبض X أو TikTok: يحذف @ البادئة، يحوّل لأحرف صغيرة، يسمح بحروف/أرقام/شرطة سفلية/نقطة
/// (نقطة مسموحة لأن TikTok يستخدمها بيوزراته، X يتجاهلها عمليًا فمقبولة كإدخال زائد غير ضار)
fn normalize_handle(raw: &str) -> Result<String> {
    let trimmed = raw.trim().trim_start_matches('@').to_lowercase();
    require!(!trimmed.is_empty(), BondingCurveError::InvalidUsername);
    require!(
        trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.'),
        BondingCurveError::InvalidUsername
    );
    Ok(trimmed)
}

/// يطبّع عنوان Gmail/إيميل: يحوّل لأحرف صغيرة، يتحقق من وجود @ واحدة بالضبط
/// مع محتوى قبلها وبعدها. تحقق شكلي بسيط، مو تحقق RFC 5322 كامل.
fn normalize_email(raw: &str) -> Result<String> {
    let trimmed = raw.trim().to_lowercase();
    let parts: Vec<&str> = trimmed.split('@').collect();
    require!(parts.len() == 2, BondingCurveError::InvalidUsername);
    require!(!parts[0].is_empty(), BondingCurveError::InvalidUsername);
    require!(!parts[1].is_empty() && parts[1].contains('.'), BondingCurveError::InvalidUsername);
    require!(
        trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._%+-@".contains(c)),
        BondingCurveError::InvalidUsername
    );
    Ok(trimmed)
}

/// يطبّع أي هوية اجتماعية (handle أو email) بحسب creator_type، ويتحقق من الطول المسموح
pub fn normalize_identity(creator_type: CreatorType, raw: &str) -> Result<String> {
    let normalized = match creator_type {
        CreatorType::X | CreatorType::TikTok => normalize_handle(raw)?,
        CreatorType::Gmail => normalize_email(raw)?,
        CreatorType::Wallet => return err!(BondingCurveError::InvalidCreatorType),
    };
    require!(
        normalized.len() <= MAX_IDENTITY_LEN,
        BondingCurveError::UsernameTooLong
    );
    Ok(normalized)
}

/// يحوّل الهوية الاجتماعية المطبَّعة إلى مصفوفة بايتات ثابتة الطول (مبطَّنة بأصفار)
pub fn encode_identity(normalized: &str) -> ([u8; MAX_IDENTITY_LEN], u8) {
    let mut buf = [0u8; MAX_IDENTITY_LEN];
    let bytes = normalized.as_bytes();
    buf[..bytes.len()].copy_from_slice(bytes);
    (buf, bytes.len() as u8)
}
