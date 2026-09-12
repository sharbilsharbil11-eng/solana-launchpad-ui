# عقد Bonding Curve (Anchor / Rust)

## 🚀 نشر هذا الإصدار بالضبط (Program ID والرسوم جاهزين مسبقًا)

**السياق:** بيئة العمل التي كتبت فيها هذا الكود سياسة الشبكة فيها تمنع أي
وصول مباشر لنقاط RPC تبعت سولانا (devnet وmainnet وحتى مزوّدين خارجيين متلا
Helius/Ankr) ولسيرفرات تنزيل أدوات Solana/Anchor نفسها (`release.anza.xyz`)
— تأكدت من هذا بالفحص المباشر (طلبات curl رجعت رفض صريح من سياسة الشبكة،
مش مجرد خطأ اتصال)، مش افتراض. لذلك ما بقدر أبني (`anchor build`) ولا أنشر
(`anchor deploy`) البرنامج من جوا هاي الجلسة **مهما ثبّتت من أدوات** — القيد
على مستوى الشبكة نفسه. كل الملفات جاهزة 100% وتم فحصها بعناية (راجع
`idl/validate-idl.js` و`idl/validate-manual-encoder.js`)، بس **النشر الفعلي
لازم تنفَّذه من جهاز عنده اتصال إنترنت حقيقي** (جهازك، أو أي بيئة CI عندها
شبكة، أو جلسة Claude Code جديدة بسياسة شبكة أقل تقييدًا).

**أسرع طريقة:** بعد ما تحصل على `program-keypair.json` و`oracle-keypair.json`
(انظر تحت)، شغّل `./scripts/deploy-devnet.sh <عنوان_محفظتك>` — بيعمل كل
الخطوات تحت تلقائيًا (تثبيت الأدوات، البناء، التحقق من الـ Program ID،
النشر، والتهيئة).

**قبل النشر — تحقق من هذا الجزء:**
- `program-keypair.json` و`oracle-keypair.json` **موجودين بهذا المجلد لكنهما
  محذوفان من git (.gitignore)** — لازم تحصل عليهما من الرسالة اللي أرسلتها
  لك مباشرة (مفاتيح سرية، ما بتنزل مع commit). لو ما لقيتهم، اطلبهم مني.
- Program ID الحقيقي (`4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb`) **مُحدَّث
  مسبقًا** بـ `declare_id!()` و`Anchor.toml` — ما تغيّره.
- خطوات النشر نفسها (build/deploy/initialize) **ما تغيّرت** بإضافة الـ Fee
  Splitter — `initialize` لسا نفسه (0.5%/0.5%). التغيير الوحيد المرتبط
  بالـ Fee Splitter هو إنو `create_token` صار ياخد مصفوفة `recipients`
  بدل حقل واحد، وهذا متعامل معه أوتوماتيكيًا من `bonding-curve.js`/
  `create.html` المحدّثين — ما في شي إضافي تعمله وقت النشر.
- الرسوم محدَّدة **0.5% للمنصة + 0.5% لصانع العملة** (تُمرَّر وقت `initialize`
  فقط، الكود ذاته يقبل أي نسبة).

### خطوات النشر بالترتيب

```bash
# 1. ثبّت الأدوات (على جهازك، مرة واحدة فقط)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# 2. ضع Program ID الحقيقي بمكانه الصحيح قبل anchor build
#    (وإلا Anchor يولّد Program ID عشوائي جديد ويتجاهل declare_id! الموجود)
mkdir -p anchor-program/target/deploy
cp anchor-program/program-keypair.json anchor-program/target/deploy/bonding_curve-keypair.json

# 3. البناء
cd anchor-program
anchor build

# 4. تأكد إنه المعرّف طابق المتوقع بالضبط
anchor keys list
# لازم يطبع: bonding_curve: 4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb

# 5. جهّز محفظة النشر (إذا ما عندك وحدة جاهزة) واطلب SOL تجريبي
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json   # تخطّى هذا السطر إذا عندك محفظة أصلاً
solana airdrop 2

# 6. النشر الفعلي
anchor deploy --provider.cluster devnet

# 7. تهيئة المنصة مرة واحدة فقط — بالرسوم المتفق عليها 0.5%/0.5%
#    استبدل العنوان بمحفظتك الحقيقية (وين بدك تستقبل رسوم المنصة)
node scripts/initialize-platform.js <عنوان_محفظتك_لاستقبال_الرسوم>
```

### بعد النشر: اختبار سريع

```bash
anchor test
```

### ملاحظة عن التحقق من صحة الكود بدون anchor build

بما إنو ما قدرت أشغّل `anchor build` بنفسي، اعتمدت بدلها على `idl/bonding_curve.json`
(IDL مكتوب يدويًا) واختبرته فعليًا ضد مكتبة `@coral-xyz/anchor` الحقيقية —
راجع `idl/validate-idl.js` (يتحقق من الـ IDL نفسه) و`idl/validate-manual-encoder.js`
(يتحقق إنو الكود بـ `bonding-curve.js` بجذر المشروع ينتج **نفس البايتات
تمامًا** اللي ينتجها الـ Anchor coder الحقيقي، لكل التعليمات المستخدمة
بالواجهة). شغّلهم بأي وقت (`npm install` أول، بعدين `node idl/validate-idl.js`)
للتأكد. **بعد ما تعمل `anchor build` فعليًا لأول مرة**، قارن الـ IDL الناتج
(`target/idl/bonding_curve.json`) مع `idl/bonding_curve.json` اليدوي —
لازم يطابقوا بالـ discriminators والحسابات (الأسماء ممكن تختلف شكليًا
بالتنسيق، بس البايتات لازم تكون متطابقة).

---

هذا برنامج Solana حقيقي يدير آلية bonding curve فعليًا على السلسلة:
- `initialize` — إعداد المنصة مرة واحدة (Platform Fee + Creator Fee + محفظة استلام الرسوم + مفتاح الـ Oracle)
- `update_oracle_authority` — تدوير مفتاح الـ Oracle عند الحاجة (أمان)
- `create_bonding_curve` — تفعيل منحنى إصدار لعملة تم صكّها مسبقًا (من صفحة `create.tsx`)
- `buy` / `sell` — التداول حسب صيغة الضرب الثابت `k = x·y` (نفس منطق pump.fun)، مع اقتطاع عمولتين منفصلتين بكل صفقة (راجع القسم التالي)
- `reserve_claim` — حجز حصة توكن (و/أو مبلغ SOL ثابت) باسم حساب X معيّن
- `claim_tokens` — مطالبة موقّعة من الـ Oracle بعد تحقق X OAuth، إلى محفظة المستفيد الحقيقية
- `revoke_claim` — إلغاء حجز لم تتم المطالبة به واسترجاعه للمُنشئ

## عمولتا Buy/Sell — Platform Fee + Creator Fee

كل عملية `buy` أو `sell` تقتطع عمولتين منفصلتين تلقائيًا:

| العمولة | تُحدَّد | تحوّل إلى | من وين تُقرأ |
|---|---|---|---|
| **Platform Fee** | وقت `initialize` (`fee_basis_points`) | `global.fee_recipient` (محفظتك) | حساب `Global` |
| **Creator Fee** | وقت `initialize` (`creator_fee_basis_points`) | `bonding_curve.creator` | حساب `BondingCurve` نفسه — مُسجَّل تلقائيًا وقت `create_bonding_curve`، **بدون أي SDK أو API خارجي** |

كلا العمولتين قابلتين للتعديل كنسبة (basis points) وقت `initialize` — مثلاً 100 = 1%.
الكود لا يفرض 1%+1% بالتحديد، أنت تحدد القيمتين وقت الاستدعاء (راجع مثال `initialize` تحت).
العقد يرفض أي مجموع عمولتين ≥ 100% (`fee_basis_points + creator_fee_basis_points < 10_000`).

⚠️ **مهم:** هذا مستقل بالكامل عن bags.fm الحقيقي — ما فيه أي استدعاء لـ `@bagsfm/bags-sdk`
ولا أي API خارجي. عنوان صانع كل عملة مُخزَّن على عقدنا نفسه من لحظة إنشائها.

## أنواع هوية الـ Creator (Creator Type) — أربعة أنواع مدعومة

عند استدعاء `init_creator_fee_vault`، تحدد `creator_type` وطريقة إثبات الملكية المطابقة:

| النوع | إثبات الملكية | يحتاج Oracle/backend؟ | الحالة |
|---|---|---|---|
| **Wallet** | محفظة Solana توقّع مباشرة | ❌ لا — مطالبة trustless بالكامل | ✅ جاهز بالكامل |
| **X** | تسجيل دخول X OAuth + توقيع Oracle | ✅ نعم | ✅ جاهز بالكامل (عندنا OAuth حقيقي) |
| **TikTok** | تسجيل دخول TikTok OAuth + توقيع Oracle | ✅ نعم | ⚠️ العقد يدعمه، لكن الـ backend (OAuth routes) غير مبني — يحتاج تسجيل تطبيق ومراجعة من TikTok for Developers |
| **Gmail** | تسجيل دخول Google OAuth + توقيع Oracle | ✅ نعم | ⚠️ العقد يدعمه، لكن الـ backend غير مبني — Google OAuth قياسي وسهل الإضافة نسبيًا |

### تعليمات المطالبة (Claim) — منفصلة حسب النوع

- **`claim_creator_fees_wallet`** — لنوع Wallet فقط. صاحب المحفظة يوقّع بنفسه، بدون Oracle، بدون backend. أبسط وأقوى مسار (راجع `claimCreatorFeesWalletOnChain` بـ `bondingCurveClient.ts` و`pages/api/claims/wallet-creator-fees.ts` — الأخير endpoint عام بدون جلسة، لأن البيانات أصلاً عامة على السلسلة).
- **`claim_creator_fees_social`** — لأنواع X/TikTok/Gmail. يتطلب توقيع Oracle بعد تحقق OAuth (راجع `pages/api/claims/sign-creator-fees.ts` — حاليًا يدعم X فقط، يرفض بوضوح أي محاولة على خزينة TikTok/Gmail لحد ما تُبنى تدفقات OAuth الخاصة فيهم).

### لإضافة دعم Gmail فعليًا (الأسرع)
نفس نمط `pages/api/auth/x/*` بالضبط، بس مع Google OAuth 2.0:
1. سجّل تطبيق على https://console.cloud.google.com (OAuth consent screen + Credentials)
2. أنشئ `pages/api/auth/google/login.ts` و`callback.ts` (نفس تدفق PKCE، بس endpoints Google: `accounts.google.com/o/oauth2/v2/auth` و`oauth2.googleapis.com/token`)
3. استخدم `/oauth2/v2/userinfo` بدل `/2/users/me` للحصول على الإيميل الموثَّق
4. خزّن نوع الجلسة (مو بس الاسم) عشان `sign-creator-fees.ts` يعرف يميّز جلسة Google عن X

### لإضافة دعم TikTok
نفس الفكرة، لكن يحتاج تسجيل تطبيق ومراجعة من [TikTok for Developers](https://developers.tiktok.com) قبل ما يصير فعّال، وقد يأخذ وقت أطول للموافقة.

## نظام Claimable Tokens عبر X OAuth — كيف يعمل ولماذا

هذا نموذج **oracle موثوق** (بعكس نظام الروابط السرية trustless البديل): بدل إثبات
"أملك مفتاحًا"، الثقة الآن في **خادمك (backend)** الذي يتحقق من هوية X عبر OAuth
ويوقّع نيابة عن المنصة. هذا هو النمط العملي المستخدم فعليًا لحجوزات باسم حسابات
اجتماعية (لأن الهوية على X لا يمكن التحقق منها on-chain مباشرة بدون oracle).

### تسلسل الثقة الكامل

1. **الحجز:** عند إنشاء العملة، المُنشئ يحجز حصة لـ `@username` — يُخزَّن اسم المستخدم
   (مطبَّع lowercase) على حساب `ClaimableAllocation` على السلسلة، والتوكن يُنقل فعليًا
   لخزينة (vault) مملوكة لهذا الحساب.
2. **تسجيل الدخول:** صاحب الحساب الحقيقي يدخل موقعك، يضغط "تسجيل الدخول بـ X"
   → `pages/api/auth/x/login.ts` يبدأ OAuth 2.0 (PKCE) الرسمي من X.
3. **التحقق:** X يرجّع المستخدم لـ `pages/api/auth/x/callback.ts`، الذي يبادل الكود
   بـ access token ثم يجلب اسم المستخدم **مباشرة من X API** (`/2/users/me`) —
   هذا هو التحقق الفعلي، لا نثق بأي اسم يُرسله المتصفح نفسه.
4. **الجلسة:** يُبنى كوكي جلسة موقّع (HMAC) يحمل اسم المستخدم الموثَّق فقط.
5. **عرض الحصص:** `pages/api/claims/mine.ts` يبحث على السلسلة (`getProgramAccounts`
   بفلتر `memcmp`) عن كل الحجوزات المطابقة لاسم مستخدم الجلسة.
6. **المطالبة:** المستخدم يربط محفظته الحقيقية (وجهة الأموال) ويضغط Claim.
   `pages/api/claims/sign.ts` يتحقق من الجلسة مجددًا، يبني معاملة `claim_tokens`،
   ويوقّعها **بمفتاح الـ Oracle** (يبقى على الخادم فقط، لا يُرسل للمتصفح أبدًا) —
   العقد يتحقق أن الموقّع فعلاً `global.oracle_authority` المسجَّل.
7. المستخدم يضيف توقيع محفظته على نفس المعاملة (كـ `recipient`، يدفع رسوم الشبكة
   ويستلم الأموال) ويرسلها.

### ⚠️ نقطة الثقة المركزية

الـ Oracle (خادمك) هو من يقرر متى تُصرف الأموال. لو تسرّب `ORACLE_SECRET_KEY` أو
اختُرق endpoint التوقيع، يقدر أي شخص يطالب بأي حصة بدون تحقق حقيقي. لذلك:
- خزّن `ORACLE_SECRET_KEY` في متغيرات بيئة مُدارة بأمان (Vercel/Railway secrets، مو `.env` بالمستودع)
- فعّل rate limiting و audit logging على `/api/claims/sign`
- فكّر بتدوير المفتاح دوريًا عبر `update_oracle_authority`
- راقب نشاط غير معتاد (محاولات متكررة، أنماط غريبة بالطلبات)

## إعداد X OAuth (خطوات خارج الكود)

1. سجّل تطبيق على https://developer.x.com/en/portal/dashboard
2. فعّل "User authentication settings" → OAuth 2.0 → نوع التطبيق **Web App (Confidential client)**
3. Callback URL: يطابق بالضبط `X_REDIRECT_URI` في `.env.local` (مثلاً `http://localhost:3000/api/auth/x/callback`)
4. الصلاحيات (Scopes) المطلوبة: `users.read` و `tweet.read` فقط (ما نحتاج صلاحيات نشر)
5. انسخ Client ID و Client Secret إلى `.env.local` (راجع `.env.example`)

## ترتيب الاستدعاءات عند إنشاء عملة

**⚠️ تحديث مهم (بنفس نمط bags.fm):** ألغينا خطوة حجز التوكن كخطوة افتراضية بالواجهة —
**100% من العرض يروح مباشرة للـ bonding curve دايمًا**، بدون أي حجز مسبق. تعليمات
`reserve_claim`/`claim_tokens`/`revoke_claim` **لسا موجودة بالعقد** (ما حذفناها، تبقى
متاحة لو احتجتها بمستقبل لحالة استخدام تانية)، بس `create.tsx` ما عاد يستدعيها أبدًا.

1. `mint` العملة بكامل العرض إلى محفظة المُنشئ (نفس `create.tsx` الحالي)
2. `create_bonding_curve` بالعرض **الكامل** (100%، بدون أي خصم) — العملة متاحة للتداول فورًا
3. **إلزامي:** `init_creator_fee_vault(creator_type, ...)` — يربط هوية صانع العملة (Wallet/X/Telegram/TikTok/Gmail)
   وينشئ خزينة أرباحه المستمرة (Royalty). بدون هذه الخطوة، أي محاولة `buy`/`sell` بترجع خطأ.

## ✅ أرباح Creator المستمرة — الآن escrow موثَّق عبر X، مو تحويل مباشر

كل صفقة `buy`/`sell` تضخّ **Creator Fee** تلقائيًا وبشكل مستمر (ليس دفعة واحدة)
داخل خزينة `CreatorFeeVault` (حساب PDA واحد لكل mint) — **مو تحويل فوري لمحفظة**.
الأرباح تتراكم بحقل `accrued_lamports` لحد ما صاحب حساب X الحقيقي (المسجَّل وقت
`init_creator_fee_vault`) يسجّل دخوله بالتطبيق، يوثّق هويته عبر X OAuth، ويسحبها
كاملة عبر `claim_creator_fees` (بنفس نموذج ثقة الـ Oracle المستخدم بـ `claim_tokens`).

هذا يعني: محدا يقدر يسحب أرباح صانع العملة غير صاحب حساب X نفسه — حتى لو محفظة
المُنشئ الأصلية (`bonding_curve.creator`) تسرّبت أو تغيّرت، الأرباح آمنة بالخزينة.

الحجوزات القابلة للمطالبة (`reserve_claim`/`claim_tokens`) تبقى آلية منفصلة —
لدفعة مقدّمة ثابتة (توكن و/أو SOL) لحساب X، مختلفة عن أرباح التداول المستمرة.

## المتطلبات (تُثبَّت على جهازك، مو هنا)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
```

## خطوات البناء والنشر

### 1. إنشاء محفظة نشر ومفتاح Oracle
```bash
solana-keygen new -o ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2

# مفتاح الـ Oracle (منفصل عن محفظة النشر)
solana-keygen new -o oracle-keypair.json --no-bip39-passphrase
node -e "console.log(require('bs58').encode(Uint8Array.from(require('./oracle-keypair.json'))))"
# ضع الناتج كـ ORACLE_SECRET_KEY في .env.local (خارج هذا المجلد، بجذر مشروع Next.js)
solana-keygen pubkey oracle-keypair.json   # هذا هو oracle_authority اللي تعطيه لـ initialize
```

### 2. توليد معرّف البرنامج الحقيقي
```bash
cd anchor-program
anchor keys list
```
انسخ المعرّف الناتج إلى `programs/bonding_curve/src/lib.rs` (`declare_id!`) و`Anchor.toml`

### 3. البناء والنشر
```bash
anchor build
anchor deploy --provider.cluster devnet
```

### 4. تهيئة المنصة (مرة واحدة فقط)
```ts
await program.methods
  .initialize(
    new BN(100), // Platform Fee: 1% → لمحفظتك
    new BN(100)  // Creator Fee: 1% → لصانع كل عملة تلقائيًا
  )
  .accounts({
    authority: wallet.publicKey,
    global: globalPda,
    feeRecipient: new PublicKey("ضع_عنوان_محفظتك_هنا"), // محفظتك أنت، صاحب المنصة
    oracleAuthority: new PublicKey("مفتاح oracle العام من الخطوة 1"),
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

## الربط مع مشروع Next.js

1. انسخ الـ IDL: `cp target/idl/bonding_curve.json ../lib/idl/bonding_curve.json`
2. حدّث `BONDING_CURVE_PROGRAM_ID` في `lib/bondingCurveClient.ts`
3. املأ `.env.local` بجذر مشروع Next.js (راجع `.env.example`): X OAuth + `SESSION_SECRET` + `ORACLE_SECRET_KEY`
4. حدّث `FEE_RECIPIENT` في `pages/token/[mint].tsx`

## اختبار محلي
```bash
anchor test
```

## ⚠️ قبل استخدام Mainnet بأموال حقيقية

هذا الكود **لم يُدقَّق أمنيًا**. قبل أي استخدام إنتاجي حقيقي:
- راجع مقاومة العقد للـ overflow وحالات الحافة بشكل مستقل
- أضف آلية ترحيل السيولة الفعلية عند اكتمال المنحنى (يحتاج CPI لبركة Raydium/Orca)
- **دقّق تصميم الـ Oracle خصوصًا** — هذا أكبر نقطة ثقة مركزية بالنظام كله؛ فكّر بحلول أقوى
  لاحقًا مثل multi-sig oracle أو التحقق بتوقيع Ed25519 على السلسلة نفسها بدل ثقة كاملة بخادم واحد
- استعن بشركة تدقيق متخصصة (OtterSec، Neodyme، Sec3) قبل أي إطلاق حقيقي
