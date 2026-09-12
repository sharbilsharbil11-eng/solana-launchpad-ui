use crate::errors::BondingCurveError;
use anchor_lang::prelude::*;

#[account]
pub struct Global {
    /// المسؤول القادر على تحديث الإعدادات العامة
    pub authority: Pubkey,
    /// محفظة صاحب المنصة (أنت) — تستلم الـ Platform Fee من كل عملية شراء/بيع.
    /// تُحدَّد وقت استدعاء initialize، فتقدر تغيّرها لاحقًا بدون إعادة نشر العقد
    /// (عبر تعليمة إدارية جديدة لو حبيت تضيفها، بنفس نمط update_oracle_authority).
    pub fee_recipient: Pubkey,
    /// المفتاح العام لخادم الـ Oracle الموثوق — لازم يوقّع (يُشارك التوقيع) كل عملية claim_tokens
    /// بعد ما يتحقق الخادم من هوية صاحب حساب X عبر OAuth. هذا هو نقطة الثقة المركزية
    /// في نظام "Claim عبر X" (بعكس نظام الروابط السرية trustless السابق).
    pub oracle_authority: Pubkey,
    /// Platform Fee بالنقاط الأساسية (100 = 1%) — تحوّل لـ fee_recipient أعلاه
    pub fee_basis_points: u64,
    /// Creator Fee بالنقاط الأساسية (100 = 1%) — تحوّل تلقائيًا لعنوان صانع كل عملة
    /// (bonding_curve.creator)، بدون أي استعلام خارجي؛ العقد نفسه هو مصدر الحقيقة
    pub creator_fee_basis_points: u64,
    pub bump: u8,
}

impl Global {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct BondingCurve {
    /// عنوان الـ mint الخاص بهذه العملة
    pub mint: Pubkey,
    /// من أنشأ العملة
    pub creator: Pubkey,

    /// الاحتياطيات الافتراضية (تحدد شكل المنحنى الرياضي، لا تمثل أموال فعلية بالكامل)
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,

    /// الاحتياطيات الحقيقية الموجودة فعليًا في الخزينة (vault) القابلة للسحب
    pub real_token_reserves: u64,
    pub real_sol_reserves: u64,

    /// إجمالي العرض الأصلي عند إنشاء المنحنى
    pub token_total_supply: u64,

    /// true إذا اكتمل المنحنى (وصل لعتبة التخرّج) وتوقف التداول عليه
    pub complete: bool,

    pub bump: u8,
}

impl BondingCurve {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1;
}

/// حجز قابل للمطالبة: حصة من التوكن (و/أو مبلغ SOL ثابت) محجوزة باسم حساب X معيّن
/// لم يربط محفظته بعد. يُطالَب بها لاحقًا بعد تسجيل دخول صاحب الحساب عبر X OAuth
/// والتحقق من هويته بواسطة خادم الـ Oracle (راجع تعليمتي reserve_claim و claim_tokens).
pub const MAX_USERNAME_LEN: usize = 32; // يوزرات X أقصاها 15 حرف؛ نحجز مساحة إضافية للأمان

#[account]
pub struct ClaimableAllocation {
    /// عنوان الـ mint للعملة المرتبطة بهذا الحجز
    pub mint: Pubkey,
    /// من أنشأ هذا الحجز (يملك صلاحية الإلغاء ما دام لم تتم المطالبة به)
    pub creator: Pubkey,

    /// اسم مستخدم X المستهدف، مطبَّع (lowercase بدون @)، مبطَّن بأصفار حتى MAX_USERNAME_LEN بايت
    pub x_username: [u8; MAX_USERNAME_LEN],
    /// الطول الفعلي لاسم المستخدم بالبايت (قبل التبطين)
    pub x_username_len: u8,

    /// كمية التوكن المحجوزة (بأصغر وحدة، مع مراعاة الـ decimals)
    pub token_amount: u64,
    /// مبلغ SOL ثابت محجوز إضافي (بوحدة lamports) — مثلاً دفعة مقدّمة من رسوم المنصة
    pub sol_amount: u64,

    pub claimed: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl ClaimableAllocation {
    pub const SIZE: usize = 8 + 32 + 32 + MAX_USERNAME_LEN + 1 + 8 + 8 + 1 + 8 + 1;

    /// يستخرج اسم المستخدم كـ String قابل للعرض (يزيل التبطين)
    pub fn username_string(&self) -> String {
        String::from_utf8_lossy(&self.x_username[..self.x_username_len as usize]).to_string()
    }
}

/// خزينة أرباح صانع العملة المتراكمة (Creator Fee Vault) — واحدة لكل mint.
/// كل صفقة buy/sell تضخّ نسبة الـ Creator Fee هنا مباشرة (accrued_lamports)
/// بدل تحويلها فورًا لمحفظة. طريقة إثبات الملكية للمطالبة تعتمد على creator_type:
///   - Wallet: مطالبة مباشرة trustless (بدون Oracle إطلاقًا) — راجع claim_creator_fees_wallet
///   - X / TikTok / Gmail: تتطلب توقيع Oracle بعد تحقق OAuth — راجع claim_creator_fees_social
pub const MAX_IDENTITY_LEN: usize = 64; // يكفي لإيميلات Gmail الطويلة نسبيًا، وأكبر من 32 بايت الخاصة بـ Pubkey

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CreatorType {
    /// محفظة Solana مباشرة — لا يحتاج أي OAuth أو Oracle، صاحب المحفظة يسحب أرباحه بنفسه دائمًا
    Wallet,
    /// حساب X (تويتر) — يحتاج توثيق X OAuth + توقيع Oracle وقت المطالبة
    X,
    /// حساب TikTok — يحتاج توثيق TikTok OAuth + توقيع Oracle وقت المطالبة
    /// ⚠️ الـ backend الخاص بتوثيق TikTok غير مبني بعد (يحتاج تسجيل تطبيق ومراجعة من TikTok for Developers)
    TikTok,
    /// حساب Gmail/Google — يحتاج توثيق Google OAuth + توقيع Oracle وقت المطالبة
    /// ⚠️ الـ backend الخاص بتوثيق Google غير مبني بعد (سهل الإضافة، OAuth قياسي)
    Gmail,
}

#[account]
pub struct CreatorFeeVault {
    /// عنوان الـ mint المرتبط بهذه الخزينة
    pub mint: Pubkey,
    /// نوع هوية صانع العملة — يحدد طريقة إثبات الملكية وقت المطالبة
    pub creator_type: CreatorType,
    /// الهوية المرتبطة، بحسب creator_type:
    ///   - Wallet: أول 32 بايت = عنوان المحفظة (Pubkey) مباشرة، البقية أصفار
    ///   - X / TikTok / Gmail: UTF-8 (يوزر مطبَّع أو إيميل)، مبطَّن بأصفار حتى MAX_IDENTITY_LEN
    pub identity: [u8; MAX_IDENTITY_LEN],
    /// الطول الفعلي بالبايت — يُستخدم فقط لأنواع social (يُتجاهل لنوع Wallet)
    pub identity_len: u8,
    /// الأرباح المتراكمة غير المسحوبة بعد (بوحدة lamports)
    pub accrued_lamports: u64,
    /// إجمالي ما تمت المطالبة به تاريخيًا (للعرض/الإحصائيات فقط)
    pub total_claimed_lamports: u64,
    pub bump: u8,
}

impl CreatorFeeVault {
    pub const SIZE: usize = 8 + 32 + 1 + MAX_IDENTITY_LEN + 1 + 8 + 8 + 1;

    /// يستخرج الهوية كـ String قابل للعرض (لأنواع X / TikTok / Gmail فقط)
    pub fn identity_string(&self) -> String {
        String::from_utf8_lossy(&self.identity[..self.identity_len as usize]).to_string()
    }

    /// يستخرج الهوية كعنوان محفظة (لنوع Wallet فقط)
    pub fn identity_pubkey(&self) -> Pubkey {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(&self.identity[..32]);
        Pubkey::new_from_array(buf)
    }
}

/// خزينة أرباح مُقسَّمة على عدة مستفيدين (Fee Splitter) — النسخة الأحدث من
/// CreatorFeeVault، تدعم حتى 5 مستفيدين بدل واحد بس. تُستخدم من create_token
/// (الحالي، الذري) وbuy/sell بدل CreatorFeeVault القديمة أعلاه. كل مستفيد له
/// حصته الخاصة (بالـ basis points من نصيب الـ Creator من الرسوم، 10_000 = 100%)
/// وأرباحه المتراكمة الخاصة به — يسحب كل واحد حصته باستقلالية تامة عن الباقي،
/// بنفس منطق الثقة السابق حسب النوع:
///   - Wallet: مطالبة مباشرة trustless (claim_fee_split_wallet)
///   - X / TikTok / Gmail: تتطلب توقيع Oracle (غير مبني بعد — بانتظار تكامل X API حقيقي)
pub const MAX_FEE_SPLIT_RECIPIENTS: usize = 5;
pub const FEE_SPLIT_TOTAL_BPS: u16 = 10_000; // 100% من نصيب الـ Creator (مش من إجمالي حجم التداول)

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct FeeSplitRecipient {
    /// نوع هوية هذا المستفيد — نفس ترميز CreatorType أعلاه
    pub creator_type: CreatorType,
    /// الهوية، بنفس ترميز CreatorFeeVault.identity (محفظة أو يوزر/إيميل مطبَّع)
    pub identity: [u8; MAX_IDENTITY_LEN],
    pub identity_len: u8,
    /// حصة هذا المستفيد من نصيب الـ Creator، بالـ basis points (10_000 = 100%).
    /// مجموع bps كل المستفيدين بنفس FeeSplitter لازم يساوي بالضبط FEE_SPLIT_TOTAL_BPS.
    pub bps: u16,
    /// الأرباح المتراكمة غير المسحوبة بعد لهذا المستفيد تحديدًا (بوحدة lamports)
    pub accrued_lamports: u64,
    /// إجمالي ما تمت المطالبة به تاريخيًا لهذا المستفيد (للعرض/الإحصائيات فقط)
    pub total_claimed_lamports: u64,
}

impl FeeSplitRecipient {
    pub const SIZE: usize = 1 + MAX_IDENTITY_LEN + 1 + 2 + 8 + 8;

    pub fn identity_string(&self) -> String {
        String::from_utf8_lossy(&self.identity[..self.identity_len as usize]).to_string()
    }

    pub fn identity_pubkey(&self) -> Pubkey {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(&self.identity[..32]);
        Pubkey::new_from_array(buf)
    }
}

impl Default for FeeSplitRecipient {
    fn default() -> Self {
        Self {
            creator_type: CreatorType::Wallet,
            identity: [0u8; MAX_IDENTITY_LEN],
            identity_len: 0,
            bps: 0,
            accrued_lamports: 0,
            total_claimed_lamports: 0,
        }
    }
}

#[account]
pub struct FeeSplitter {
    /// عنوان الـ mint المرتبط بهذه الخزينة — واحدة لكل mint، بديل CreatorFeeVault
    pub mint: Pubkey,
    /// عدد المستفيدين الفعليين المستخدَمين من المصفوفة أدناه (1 إلى MAX_FEE_SPLIT_RECIPIENTS)
    pub recipient_count: u8,
    /// مصفوفة ثابتة الحجم (Fee Splitter Array) — المدخلات الفارغة (index >= recipient_count)
    /// تبقى بقيمها الافتراضية (bps = 0) ويتم تجاهلها بكل مكان
    pub recipients: [FeeSplitRecipient; MAX_FEE_SPLIT_RECIPIENTS],
    pub bump: u8,
}

impl FeeSplitter {
    pub const SIZE: usize =
        8 + 32 + 1 + (FeeSplitRecipient::SIZE * MAX_FEE_SPLIT_RECIPIENTS) + 1;

    /// يوزّع مبلغ لامبورت واحد (نصيب الـ Creator من رسوم صفقة buy/sell) على كل
    /// مستفيدي المصفوفة حسب حصة كل واحد (bps)، ويضيف باقي القسمة الصحيحة
    /// (rounding remainder) لأول مستفيد — بهيك مجموع ما يتراكم لكل المستفيدين
    /// يساوي amount بالضبط، ما في ولا لامبورت واحد بيضيع أو ينخلق من فراغ.
    pub fn distribute(&mut self, amount: u64) -> Result<()> {
        let count = self.recipient_count as usize;
        require!(count > 0, BondingCurveError::InvalidFeeSplitRecipientCount);

        let mut distributed: u64 = 0;
        for i in 0..count {
            let share = (amount as u128)
                .checked_mul(self.recipients[i].bps as u128)
                .ok_or(BondingCurveError::MathOverflow)?
                .checked_div(FEE_SPLIT_TOTAL_BPS as u128)
                .ok_or(BondingCurveError::MathOverflow)? as u64;
            self.recipients[i].accrued_lamports = self.recipients[i]
                .accrued_lamports
                .checked_add(share)
                .ok_or(BondingCurveError::MathOverflow)?;
            distributed = distributed
                .checked_add(share)
                .ok_or(BondingCurveError::MathOverflow)?;
        }

        let remainder = amount
            .checked_sub(distributed)
            .ok_or(BondingCurveError::MathOverflow)?;
        if remainder > 0 {
            self.recipients[0].accrued_lamports = self.recipients[0]
                .accrued_lamports
                .checked_add(remainder)
                .ok_or(BondingCurveError::MathOverflow)?;
        }
        Ok(())
    }
}

/// معطى تعليمة create_token (مش مخزَّن على السلسلة بهالشكل) — هوية مستفيد واحد
/// + حصته المطلوبة بالمصفوفة. الـ handler يطبّع الهوية ويحوّلها لـ FeeSplitRecipient.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FeeSplitRecipientInput {
    pub creator_type: CreatorType,
    pub social_handle: Option<String>,
    pub wallet: Option<Pubkey>,
    pub bps: u16,
}
