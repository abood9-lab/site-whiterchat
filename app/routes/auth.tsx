import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from '@remix-run/react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
} from '~/lib/firebase';
import { ensureUserProfileOnAuth, sanitizeUsername } from '~/lib/persistence/db';

const AUTH_VIDEO_URL = import.meta.env.VITE_AUTH_VIDEO_URL || '';

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const [isSignUp, setIsSignUp] = useState(initialMode === 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        navigate('/chat/new', { replace: true });
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = canvas.parentElement?.clientWidth || 600);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 800);

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };
    window.addEventListener('resize', handleResize);

    const particles: Array<{ x: number; y: number; vx: number; vy: number; radius: number }> = [];
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        radius: Math.random() * 2 + 1,
      });
    }

    const render = () => {
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';

      particles.forEach((p, idx) => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let j = idx + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

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

  const handleAuthSubmit = async (e: React.FormEvent) => {
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

      navigate('/chat/new', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);

    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const user = userCredential.user;

      await ensureUserProfileOnAuth(user);

      navigate('/chat/new', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#ffffff] text-slate-900 font-sans">
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-8 sm:p-12 lg:p-16 xl:p-24 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between mb-12">
            <a href="/" className="flex items-center gap-3 text-xl font-bold tracking-tight text-slate-900">
              <div className="w-9 h-9 rounded-xl bg-[#0284c7] flex items-center justify-center text-white font-black shadow-md shadow-sky-500/20">
                AI
              </div>
              <span>Bolt Studio</span>
            </a>
            <a href="/" className="text-sm font-medium text-slate-500 hover:text-[#0284c7] transition-colors">
              ← Back to Home
            </a>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mb-3">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="text-sm sm:text-base text-slate-600">
              {isSignUp
                ? 'Start building and persisting AI workspaces instantly with Daytona Volumes and Firebase.'
                : 'Access your persistent AI chat sessions, isolated Daytona Volumes, and sandbox workspaces.'}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-sm text-slate-700 shadow-sm transition-all mb-6 disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
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

          <div className="flex items-center my-6">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="px-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Or with email</span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {isSignUp && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={128}
                    value={displayName}
                    onChange={(e) => handleDisplayNameChange(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] transition-all text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold">
                      @
                    </span>
                    <input
                      type="text"
                      required
                      maxLength={64}
                      value={username}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      placeholder="username"
                      className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] transition-all text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-[#f0f9ff]/30 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0284c7] transition-all text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 rounded-xl bg-[#0284c7] hover:bg-[#0369a1] text-white font-bold text-sm shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-sm text-slate-600">
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

        <div className="text-xs text-slate-400 mt-12 text-center">
          Secured by Firebase Authentication &amp; Persistent Daytona Volumes.
        </div>
      </div>

      <div className="hidden lg:flex lg:w-1/2 relative bg-slate-950 overflow-hidden items-center justify-center p-12">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover opacity-90" />
        {AUTH_VIDEO_URL && (
          <video
            src={AUTH_VIDEO_URL}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-75"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

        <div className="relative z-10 max-w-lg text-white">
          <div className="text-sky-300 text-xs font-semibold mb-4">
            Daytona Volumes &amp; Firebase Unified
          </div>
          <h2 className="text-3xl xl:text-4xl font-extrabold tracking-tight mb-4 leading-tight">
            Enterprise AI Engineering at Your Fingertips
          </h2>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed mb-8">
            Experience real-time multi-provider model orchestration, persistent Daytona Volume workspaces, and secure conversation history across all your devices.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10">
              <div className="text-2xl font-black text-sky-400 mb-1">440+</div>
              <div className="text-xs text-slate-300">Active AI Models</div>
            </div>
            <div className="p-4 rounded-2xl bg-white/10 backdrop-blur-md border border-white/10">
              <div className="text-2xl font-black text-sky-400 mb-1">100%</div>
              <div className="text-xs text-slate-300">Persistent Daytona Volumes</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
