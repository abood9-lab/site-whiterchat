'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';
import Link from 'next/link';

const translations = {
  ar: {
    mail: 'البريد الإلكتروني', pass: 'كلمة المرور', login: 'دخول آمن',
    forgot: 'نسيت كلمة المرور؟', reset: 'استعادة', signup: 'سجل الآن',
    no_acc: 'ليس لديك حساب؟', rec_h: 'استعادة الحساب',
    rec_d: 'أدخل إيميلك وسنرسل لك رابطاً رسمياً لتغيير كلمة المرور',
    send: 'إرسال رابط التغيير', err: 'خطأ في بيانات الدخول ❌',
    write_mail: 'يرجى كتابة الإيميل أولاً', sent: '📩 تم إرسال الرابط لإيميلك بنجاح',
  },
  en: {
    mail: 'Email Address', pass: 'Password', login: 'Secure Login',
    forgot: 'Forgot Password?', reset: 'Recover', signup: 'Sign Up',
    no_acc: 'No account?', rec_h: 'Account Recovery',
    rec_d: 'Enter your email to receive a secure password reset link',
    send: 'Send Reset Link', err: 'Invalid Login Credentials ❌',
    write_mail: 'Please enter your email', sent: '📩 Reset link sent to your email',
  },
};

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { toasts, showToast } = useToast();
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [btnDisabled, setBtnDisabled] = useState(true);
  const [showRecover, setShowRecover] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    const detected = typeof navigator !== 'undefined' && navigator.language.startsWith('ar') ? 'ar' : 'en';
    setLang(detected);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/feed');
  }, [user, loading, router]);

  const t = translations[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const validate = (e: string, p: string) => {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    setBtnDisabled(!(emailOk && p.length >= 6));
  };

  const handleLogin = async () => {
    if (btnDisabled || loggingIn) return;
    setLoggingIn(true);
    setBtnDisabled(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace('/welcome');
    } catch {
      showToast(t.err, 'error');
      setBtnDisabled(false);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleReset = async () => {
    if (!recoverEmail) return showToast(t.write_mail, 'error');
    try {
      await sendPasswordResetEmail(auth, recoverEmail);
      showToast(t.sent);
      setTimeout(() => setShowRecover(false), 2500);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Error', 'error');
    }
  };

  if (loading) return <div className="fixed inset-0 bg-[#020202] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#020202] flex items-center justify-center p-5" dir={dir}>
      <Toast toasts={toasts} />

      <div className="w-full max-w-[400px] p-[45px_25px] bg-[rgba(255,255,255,0.04)] border border-[rgba(0,255,136,0.15)] rounded-[32px] backdrop-blur-[25px] text-center">
        <h2 className="text-[#00ff88] mb-[35px] text-[32px] font-black">Whiterchat</h2>

        <div className="relative mb-[15px]">
          <input
            type="email"
            placeholder={t.mail}
            value={email}
            onChange={e => { setEmail(e.target.value); validate(e.target.value, password); }}
            className="w-full p-[17px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
            spellCheck={false}
            autoComplete="email"
          />
        </div>
        <div className="relative mb-[15px]">
          <input
            type="password"
            placeholder={t.pass}
            value={password}
            onChange={e => { setPassword(e.target.value); validate(email, e.target.value); }}
            onKeyDown={e => e.key === 'Enter' && !btnDisabled && handleLogin()}
            className="w-full p-[17px] bg-[rgba(0,0,0,0.6)] border border-[#222] border-l-4 border-l-transparent rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] focus:border-l-[#00ff88] focus:bg-black transition-all"
            autoComplete="current-password"
          />
        </div>

        <button
          onClick={handleLogin}
          disabled={btnDisabled}
          className="w-full p-[18px] bg-[#00ff88] text-black border-none rounded-[16px] font-extrabold cursor-pointer text-[17px] mt-[15px] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loggingIn ? '...' : t.login}
        </button>

        <div className="mt-[25px] text-sm text-[#8e8e8e]">
          <span>{t.forgot} </span>
          <button onClick={() => setShowRecover(true)} className="text-[#00ff88] font-bold cursor-pointer bg-none border-none p-[5px]">{t.reset}</button>
          <br /><br />
          <span>{t.no_acc} </span>
          <Link href="/signup" className="text-[#00ff88] font-bold">{t.signup}</Link>
        </div>
      </div>

      {showRecover && (
        <div
          className="fixed inset-0 bg-[rgba(0,0,0,0.98)] z-[9999] flex items-center justify-center backdrop-blur-[15px] p-5"
          onClick={e => { if (e.target === e.currentTarget) setShowRecover(false); }}
        >
          <div className="w-full max-w-[360px] p-[45px_25px] bg-[rgba(255,255,255,0.04)] border border-[rgba(0,255,136,0.15)] rounded-[32px] text-center">
            <h3 className="text-white text-xl font-bold mb-2">{t.rec_h}</h3>
            <p className="text-xs text-[#8e8e8e] mb-5">{t.rec_d}</p>
            <input
              type="email"
              placeholder={t.mail}
              value={recoverEmail}
              onChange={e => setRecoverEmail(e.target.value)}
              className="w-full p-[17px] bg-[rgba(0,0,0,0.6)] border border-[#222] rounded-[16px] text-white text-base outline-none focus:border-[#00ff88] mb-4 transition-all"
            />
            <button
              onClick={handleReset}
              className="w-full p-[18px] bg-[#00ff88] text-black border-none rounded-[16px] font-extrabold cursor-pointer text-[17px]"
            >
              {t.send}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
