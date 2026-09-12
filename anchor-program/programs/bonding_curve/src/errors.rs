use anchor_lang::prelude::*;

#[error_code]
pub enum BondingCurveError {
    #[msg("المنحنى مكتمل بالفعل ولا يقبل تداولات جديدة")]
    CurveComplete,

    #[msg("رصيد التوكن المتاح في المنحنى غير كافٍ لهذه العملية")]
    InsufficientTokenReserves,

    #[msg("المبلغ المطلوب لا يحقق الحد الأدنى المقبول (تجاوز الانزلاق السعري / slippage)")]
    SlippageExceeded,

    #[msg("مبلغ SOL يجب أن يكون أكبر من صفر")]
    InvalidSolAmount,

    #[msg("مبلغ التوكن يجب أن يكون أكبر من صفر")]
    InvalidTokenAmount,

    #[msg("حدث تجاوز في العمليات الحسابية (overflow)")]
    MathOverflow,

    #[msg("رسوم المنصة غير صالحة (يجب أن تكون أقل من 100%)")]
    InvalidFeeBasisPoints,

    #[msg("فقط منشئ المنحنى أو المسؤول مخوّل بهذه العملية")]
    Unauthorized,

    #[msg("تم المطالبة بهذا الحجز مسبقًا")]
    AlreadyClaimed,

    #[msg("لا يوجد شيء محجوز في هذا الحساب")]
    NothingReserved,

    #[msg("مفتاح الاستحقاق (claim authority) لا يطابق الحجز المحدد")]
    InvalidClaimAuthority,

    #[msg("لا يمكن إلغاء حجز تمت المطالبة به بالفعل")]
    CannotRevokeClaimed,

    #[msg("اسم مستخدم X غير صالح (يُسمح بحروف/أرقام/شرطة سفلية فقط)")]
    InvalidUsername,

    #[msg("اسم مستخدم X أطول من الحد المسموح")]
    UsernameTooLong,

    #[msg("توقيع الـ Oracle غير صالح أو لا يطابق الخادم المخوَّل")]
    InvalidOracle,

    #[msg("اسم المستخدم لا يطابق صاحب خزينة أرباح الـ Creator المسجَّل")]
    CreatorUsernameMismatch,

    #[msg("لا يوجد أرباح متراكمة للمطالبة بها حاليًا")]
    NothingToClaim,

    #[msg("نوع المنشئ (Creator Type) غير صالح لهذه العملية")]
    InvalidCreatorType,

    #[msg("هوية المحفظة المُطالِبة لا تطابق المحفظة المسجَّلة لهذه الخزينة")]
    WalletIdentityMismatch,

    #[msg("لازم تحدد إما مقبض/إيميل اجتماعي (لأنواع X/TikTok/Gmail) أو عنوان محفظة (لنوع Wallet)")]
    MissingCreatorIdentity,

    #[msg("لازم يكون في مستفيد واحد على الأقل، وبحد أقصى 5 مستفيدين بمصفوفة توزيع الرسوم")]
    InvalidFeeSplitRecipientCount,

    #[msg("مجموع نسب مصفوفة توزيع الرسوم (bps) لازم يساوي بالضبط 10000 (100%)")]
    InvalidFeeSplitTotal,

    #[msg("رقم المستفيد المحدد غير موجود بمصفوفة توزيع الرسوم لهذه العملة")]
    InvalidFeeSplitRecipientIndex,
}
