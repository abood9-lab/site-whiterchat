'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';
import Link from 'next/link';

const translations = {
  ar: {
    title: 'إنشاء حساب', name: 'الاسم الكامل', user: 'اسم المستخدم',
    mail: 'البريد الإلكتروني', pass: 'كلمة المرور (8+ حروف)',
    signup: 'إرسال كود التحقق',
    legal: 'بالتسجيل، أنت توافق على <a href="/terms" class="text-[#00ff88] font-bold no-underline">شروط الاستخدام</a> و <a href="/privacy" class="text-[#00ff88] font-bold no-underline">سياسة الخصوصية</a>.',
    login: 'لديك حساب بالفعل؟ سجل دخول',
    otp_t: 'تأكيد الهوية', otp_s: 'أدخل الكود المرسل لبريدك (صالح لـ 5 دقائق)',
    verify: 'تفعيل الحساب', err_user: 'اسم المستخدم محجوز ❌',
    ok_user: 'اسم المستخدم متاح ✅', err_otp: 'الكود خاطئ أو منتهي الصلاحية',
    wait: 'يرجى الانتظار: ', resend: 'لم يصلني الكود؟ إعادة الإرسال',
    sent_ok: 'تم إرسال الرمز بنجاح ✅', fail_send: 'فشل الإرسال، حاول لاحقاً ❌',
  },
  en: {
    title: 'Sign Up', name: 'Full Name', user: 'Username',
    mail: 'Email', pass: 'Password (8+ chars)',
    signup: 'Send Code',
    legal: 'By signing up, you agree to our <a href="/terms" class="text-[#00ff88] font-bold no-underline">Terms</a> & <a href="/privacy" class="text-[#00ff88] font-bold no-underline">Privacy Policy</a>.',
    login: 'Already have an account? Log In',
    otp_t: 'Verify Identity', otp_s: 'Enter code from email (valid 5 min)',
    verify: 'Activate', err_user: 'Taken ❌',
    ok_user: 'Available ✅', err_otp: 'Invalid or expired code',
    wait: 'Wait: ', resend: 'Resend Code',
    sent_ok: 'Code sent successfully ✅', fail_send: 'Failed to send ❌',
  },
};

export default function SignupPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { toasts, showToast } = useToast();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [fullname, setFullname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isUserValid, setIsUserValid] = useState(false);
  const [userHint, setUserHint] = useState('');
  const [userHintColor, setUserHintColor] = useState('');
  const [btnDisabled, setBtnDisabled] = useState(true);
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [showResend, setShowResend] = useState(false);
  const [cooldownActive, setCooldownActive] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const detected = typeof navigator !== 'undefined' && navigator.language.startsWith('en') ? 'en' : 'ar';
    setLang(detected);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/feed');
  }, [user, loading, router]);

  const t = translations[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const validateFields = (n = fullname, u = username, e = email, p = password, uValid = isUserValid, cdActive = cooldownActive) => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    setBtnDisabled(!(n.length >= 3 && uValid && emailOk && p.length >= 8 && !cdActive));
  };

  const checkUsername = async (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    if (cleaned.length < 3) { setIsUserValid(false); setUserHint(''); validateFields(fullname, cleaned, email, password, false); return; }
    const q = query(collection(db, 'users'), where('username', '==', cleaned));
    const snap = await getDocs(q);
    const valid = snap.empty;
    setIsUserValid(valid);
    setUserHint(valid ? t.ok_user : t.err_user);
    setUserHintColor(valid ? '#00ff88' : '#ff4d4d');
    validateFields(fullname, cleaned, email, password, valid);
  };

  const startCooldown = (seconds: number) => {
    setCooldownActive(true);
    setCooldown(seconds);
    setShowResend(false);
    let left = seconds;
    cooldownRef.current = setInterval(() => {
      left--;
      setCooldown(left);
      if (left <= 0) {
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        setCooldown(0);
        setCooldownActive(false);
        setShowResend(true);
        validateFields(fullname, username, email, password, isUserValid, false);
      }
    }, 1000);
  };

  const triggerEmailSend = async () => {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const otp = String(100000 + (array[0] % 900000));
    const payload = {
      service_id: 'service_51cc49c',
      template_id: 'template_j7epq4q',
      user_id: 'mavpiHbGoq6KszVnP',
      template_params: { email, passcode: otp },
    };
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        await setDoc(doc(db, 'otp_temp', email), {
          code: otp, user: username, name: fullname,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        setShowOtp(true);
        startCooldown(60);
        showToast(t.sent_ok);
        sessionStorage.setItem('_u_secure_p', btoa(password));
      } else throw new Error();
    } catch {
      showToast(t.fail_send, 'error');
      setCooldownActive(false);
      validateFields();
    }
  };

  const handleSignup = () => {
    setCooldownActive(true);
    validateFields(fullname, username, email, password, isUserValid, true);
    triggerEmailSend();
  };

  const verifyOtp = async () => {
    try {
      const { getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(db, 'otp_temp', email));
      if (!snap.exists()) return showToast(t.err_otp, 'error');
      const data = snap.data();
      if (data.code === otpCode && Date.now() < data.expiresAt) {
        const pass = atob(sessionStorage.getItem('_u_secure_p') || '');
        const userCred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(userCred.user, { displayName: data.name });
        await setDoc(doc(db, 'users', userCred.user.uid), {
          uid: userCred.user.uid, username: data.user, fullname: data.name,
          email, createdAt: new Date(),
        });
        sessionStorage.removeItem('_u_secure_p');
        router.replace('/welcome');
      } else {
        showToast(t.err_otp, 'error');
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  if (loading) return <div className="fixed inset-0 bg-[#020202] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#020202] flex items-center justify-center p-5 overflow-x-hidden" dir={dir}>
      <Toast toasts={toasts} />

      <div className="w-full max-w-[400px] p-[40px_25px] bg-[rgba(255,255,255,0.04)] border border-[rgba(0,255,136,0.15)] rounded-[32px] backdrop-blur-[25px] text-center shadow-[0_25px_50px_rgba(0,0,0,0.5)]">
        <h2 className="text-[#00ff88] mb-[30px] text-[32px] font-black tracking-tight">{t.title}</h2>

        <div className="relative mb-[15px]">
          <input type="text" placeholder={t.name} value={fullname}
            onChange={e => { setFullname(e.target.value); validateFields(e.target.value, username, email, password, isUserValid); }}
            className="w-full p-[16px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
          />
        </div>

        <div className="relative mb-[15px]">
          <input type="text" placeholder={t.user} value={username}
            onChange={e => checkUsername(e.target.value)}
            className="w-full p-[16px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
          />
          {userHint && <div className="text-[11px] mt-[5px] h-[14px] font-semibold" style={{ color: userHintColor }}>{userHint}</div>}
        </div>

        <div className="relative mb-[15px]">
          <input type="email" placeholder={t.mail} value={email}
            onChange={e => { setEmail(e.target.value); validateFields(fullname, username, e.target.value, password, isUserValid); }}
            className="w-full p-[16px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
            spellCheck={false} autoComplete="email"
          />
        </div>

        <div className="relative mb-[15px]">
          <input type="password" placeholder={t.pass} value={password}
            onChange={e => { setPassword(e.target.value); validateFields(fullname, username, email, e.target.value, isUserValid); }}
            className="w-full p-[16px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
            autoComplete="new-password"
          />
        </div>

        <button onClick={handleSignup} disabled={btnDisabled}
          className="w-full p-[18px] bg-[#00ff88] text-black border-none rounded-[16px] font-extrabold cursor-pointer text-[17px] mt-[15px] transition-all disabled:bg-[#1a1a1a] disabled:text-[#444] disabled:cursor-not-allowed"
        >
          {t.signup}
        </button>

        <div className="mt-[25px] border-t border-[rgba(255,255,255,0.08)] pt-[25px]">
          <p className="text-xs text-[#8e8e8e] leading-relaxed mb-[15px]" dangerouslySetInnerHTML={{ __html: t.legal }} />
          <Link href="/login" className="bg-none border-none text-white text-sm cursor-pointer p-[10px] no-underline hover:text-[#00ff88]">{t.login}</Link>
        </div>
      </div>

      {showOtp && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.98)] z-[9999] flex items-center justify-center backdrop-blur-[10px]">
          <div className="w-full max-w-[340px] p-[40px_25px] bg-[rgba(255,255,255,0.04)] border border-[rgba(0,255,136,0.15)] rounded-[32px] text-center" dir={dir}>
            <h3 className="text-white text-xl font-bold mb-2">{t.otp_t}</h3>
            <p className="text-xs text-[#8e8e8e] mb-5">{t.otp_s}</p>
            <input
              type="text" value={otpCode} onChange={e => setOtpCode(e.target.value)}
              maxLength={6} inputMode="numeric"
              className="w-full p-[16px] bg-black border border-[#222] rounded-[16px] text-[#00ff88] text-[32px] tracking-[10px] font-bold text-center outline-none"
            />
            <button onClick={verifyOtp}
              className="w-full p-[18px] bg-[#00ff88] text-black border-none rounded-[16px] font-extrabold cursor-pointer text-[17px] mt-[15px]"
            >
              {t.verify}
            </button>
            {cooldown > 0 && <div className="text-[11px] text-[#ff4d4d] mt-[15px]">{t.wait}{cooldown}s</div>}
            {showResend && (
              <button onClick={triggerEmailSend}
                className="bg-none border-none text-[#00ff88] text-[13px] mt-[15px] cursor-pointer underline font-bold"
              >
                {t.resend}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
