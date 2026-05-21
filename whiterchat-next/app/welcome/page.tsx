'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function WelcomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const textRef = useRef<HTMLHeadingElement>(null);
  const boyRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLAnchorElement>(null);
  const [isAr, setIsAr] = useState(true);
  const [text, setText] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login'); return; }

    const ar = typeof navigator !== 'undefined' && navigator.language.startsWith('ar');
    setIsAr(ar);
    const name = user.displayName ? user.displayName.split(' ')[0] : (ar ? 'صديقي' : 'Friend');
    const welcome = ar ? `أهلاً بك يا ${name}!` : `Welcome, ${name}!`;
    setText(welcome);
  }, [user, loading, router]);

  useEffect(() => {
    if (!text || !textRef.current || !boyRef.current || !btnRef.current) return;
    const el = textRef.current;
    const boy = boyRef.current;
    const btn = btnRef.current;

    el.style.animation = `typing-cursor ${Math.max(2, text.length * 0.12)}s steps(${text.length}) forwards`;
    boy.style.display = 'block';

    let startTime: number | null = null;
    const duration = Math.max(2000, text.length * 120);

    const moveBoy = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      let progress = (timestamp - startTime) / duration;
      if (progress > 1) progress = 1;

      const textRect = el.getBoundingClientRect();
      const currentWidth = progress * textRect.width;
      const bounce = Math.sin(timestamp / 80) * 5;

      if (isAr) {
        boy.style.left = 'auto';
        boy.style.right = (currentWidth - 40) + 'px';
        boy.style.transform = `scaleX(-1) translateY(${bounce}px)`;
      } else {
        boy.style.right = 'auto';
        boy.style.left = (currentWidth - 40) + 'px';
        boy.style.transform = `translateY(${bounce}px)`;
      }

      if (progress < 1) {
        requestAnimationFrame(moveBoy);
      } else {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.transform = 'translateY(0)';
        setTimeout(() => { router.replace('/feed'); }, 5000);
      }
    };

    requestAnimationFrame(moveBoy);
  }, [text, isAr, router]);

  if (loading) return <div className="fixed inset-0 bg-[#020202] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div
      className="m-0 p-0 h-screen flex items-center justify-center overflow-hidden"
      style={{ background: '#020202', fontFamily: "'Segoe UI', Tahoma, sans-serif" }}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div
        className="relative w-[90%] max-w-[800px] rounded-[20px] p-[60px_40px] flex flex-col items-center"
        style={{
          background: '#1a2e1a',
          border: '15px solid #4e342e',
          boxShadow: 'inset 0 0 100px #000, 0 30px 60px rgba(0,0,0,0.8)',
        }}
      >
        <div className="relative w-full flex items-center justify-center min-h-[120px]">
          <h1
            ref={textRef}
            className="overflow-hidden whitespace-nowrap w-0"
            style={{
              fontFamily: "'Comic Sans MS', cursive",
              fontSize: 'clamp(22px, 5vw, 40px)',
              color: 'rgba(255,255,255,0.9)',
              borderRight: '3px solid transparent',
              textShadow: '2px 2px 4px rgba(0,0,0,0.4)',
              margin: 0,
            }}
          >
            {text}
          </h1>
          <div
            ref={boyRef}
            className="absolute text-[80px] z-10 pointer-events-none leading-none"
            style={{ display: 'none' }}
          >
            ✍️
          </div>
        </div>

        <Link
          ref={btnRef}
          href="/feed"
          className="mt-[40px] text-black font-black rounded-[50px] no-underline transition-all"
          style={{
            background: '#00ff88',
            padding: '15px 40px',
            opacity: 0,
            pointerEvents: 'none',
            transform: 'translateY(20px)',
            transition: '0.5s',
          }}
        >
          {isAr ? 'دخول للمنصة' : 'ENTER FEED'}
        </Link>
      </div>
    </div>
  );
}
