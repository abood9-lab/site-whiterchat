'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';

export default function SplashPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        router.replace(user ? '/feed' : '/signup');
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [user, loading, router]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-[9999]">
      <div className="w-[110px] h-[110px] rounded-[25px] shadow-[0_0_40px_#00ff99] overflow-hidden">
        <Image src="/logo.png" alt="WhiterChat" width={110} height={110} className="rounded-[25px]" />
      </div>
      <div className="mt-5 text-2xl font-bold text-[#00ff99]">WhiterChat</div>
      <div className="w-[140px] h-[3px] bg-[#222] mt-5 overflow-hidden rounded-[10px]">
        <div className="h-full bg-[#00ff99] w-0 animate-load-bar" />
      </div>
    </div>
  );
}
