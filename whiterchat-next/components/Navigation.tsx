'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Film, Mail, PlusSquare, Bell, User } from 'lucide-react';

const navItems = [
  { href: '/feed', icon: Home, label: 'Home' },
  { href: '/search', icon: Search, label: 'Search' },
  { href: '/reels', icon: Film, label: 'Reels' },
  { href: '/messages', icon: Mail, label: 'Messages' },
  { href: '/create-post', icon: PlusSquare, label: 'Create' },
  { href: '/notifications', icon: Bell, label: 'Notifications', desktopOnly: true },
  { href: '/profile', icon: User, label: 'Profile' },
];

export default function Navigation() {
  const pathname = usePathname();
  return (
    <>
      {/* Mobile header */}
      <header className="md:hidden fixed top-0 left-0 w-full h-[60px] bg-[rgba(1,8,11,0.9)] backdrop-blur-lg border-b border-[rgba(0,255,136,0.2)] flex justify-between items-center px-5 z-[2500]">
        <span className="text-2xl font-black text-[#00ff88] italic">Whiterchat</span>
        <Link href="/notifications" className="text-white text-xl"><Bell size={22} /></Link>
      </header>
      {/* Bottom nav mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[rgba(15,30,35,0.9)] backdrop-blur-xl border-t border-[rgba(0,255,136,0.2)] flex justify-around items-start pt-2.5 z-[2000] pb-safe">
        {navItems.filter(i => !i.desktopOnly).map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={`text-[22px] no-underline transition-colors ${pathname === href ? 'text-[#00ff88]' : 'text-white'}`} aria-label={label}>
            <Icon size={24} />
          </Link>
        ))}
      </nav>
      {/* Sidebar desktop */}
      <nav className="hidden md:flex fixed top-0 left-0 h-screen w-[280px] flex-col p-7 gap-1 bg-[rgba(15,30,35,0.9)] backdrop-blur-xl border-r border-[rgba(0,255,136,0.2)] z-[2000]">
        <div className="text-[30px] font-black text-[#00ff88] italic mb-10">Whiterchat</div>
        {navItems.map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} className={`flex items-center gap-4 px-5 py-3 rounded-2xl no-underline transition-all ${pathname === href ? 'bg-[rgba(0,255,136,0.1)] text-[#00ff88]' : 'text-[rgba(255,255,255,0.6)] hover:bg-[rgba(0,255,136,0.1)] hover:text-[#00ff88]'}`}>
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
