import { useState } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from '~/lib/firebase';
import { ensureUserProfileOnAuth, sanitizeUsername } from '~/lib/persistence/db';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleDisplayNameChange = (value: string) => {
    setDisplayName(value);
    if (!usernameTouched) {
      setUsername(sanitizeUsername(value));
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsernameTouched(true);
    setUsername(sanitizeUsername(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let userCredential;
      if (isSignUp) {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }

      const user = userCredential.user;
      await ensureUserProfileOnAuth(
        user,
        isSignUp
          ? {
              displayName: displayName.trim() || email.split('@')[0],
              username: username.trim() || undefined,
            }
          : undefined,
      );

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);

    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const user = userCredential.user;

      await ensureUserProfileOnAuth(user);

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-8 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
        >
          ✕
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#0284c7] flex items-center justify-center text-white font-black text-lg mx-auto mb-3 shadow-md shadow-sky-500/20">
            AI
          </div>
          <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">
            {isSignUp ? 'Create your account' : 'Sign in to continue'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            {isSignUp
              ? 'Join Nexus Studio to generate and sync full-stack AI apps.'
              : 'Sign in to execute your prompt and access your chat workspace.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}

        {/* Google Button */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-xs sm:text-sm text-slate-700 shadow-sm transition-all mb-4 disabled:opacity-50 cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.95H1.2v3.14C3.18 21.36 7.23 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.25c-.25-.72-.39-1.5-.39-2.25s.14-1.53.39-2.25V6.61H1.2C.44 8.14 0 9.88 0 12s.44 3.86 1.2 5.39l4.08-3.14z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.23 0 3.18 2.64 1.2 6.61l4.08 3.14c.95-2.84 3.6-4.95 6.72-4.95z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center my-4">
          <div className="flex-grow border-t border-slate-200"></div>
          <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Or with email</span>
          <div className="flex-grow border-t border-slate-200"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={128}
                  value={displayName}
                  onChange={(e) => handleDisplayNameChange(e.target.value)}
                  placeholder="Shahed Almefleh"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] text-xs sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Username
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold">@</span>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder="shahed_dev"
                    className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] text-xs sm:text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] text-xs sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] text-xs sm:text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-xs sm:text-sm shadow-md shadow-sky-500/25 transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-slate-600">
            {isSignUp ? 'Already have an account?' : "Don't have an account yet?"}{' '}
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="font-bold text-[#0284c7] hover:underline cursor-pointer ml-1"
            >
              {isSignUp ? 'Sign In' : 'Create Account'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
