import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: '#000000', color: '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <header className="fixed top-0 w-full h-[70px] bg-[rgba(0,0,0,0.8)] backdrop-blur-[20px] flex items-center justify-between px-5 border-b border-[rgba(0,255,136,0.1)] z-[1000]">
        <div className="text-[#00ff88] font-black text-lg">WhiterChat</div>
        <Link href="/login" className="bg-[#00ff88] text-black border-none px-4 py-[6px] rounded-[10px] font-bold cursor-pointer no-underline text-sm">Sign In</Link>
      </header>

      <main className="max-w-[900px] mx-auto px-5 pt-[100px] pb-20">
        <h1 className="text-[#00ff88] text-3xl font-black mb-2">Privacy Policy</h1>
        <p className="text-[#777] text-sm mb-8">Last updated: 2026</p>

        {[
          { title: '1. Information We Collect', content: 'We collect information you provide directly to us, such as when you create an account, post content, or communicate with other users. This includes your name, email address, username, profile photo, and any content you post.' },
          { title: '2. How We Use Your Information', content: 'We use the information we collect to provide, maintain, and improve our services, process transactions, send you technical notices and support messages, and respond to your comments and questions.' },
          { title: '3. Information Sharing', content: 'We do not sell, trade, or otherwise transfer your personal information to third parties without your consent, except as described in this policy. We may share your information with service providers who assist us in operating our platform.' },
          { title: '4. Data Security', content: 'We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet is 100% secure.' },
          { title: '5. Cookies', content: 'We use cookies and similar tracking technologies to track activity on our platform and hold certain information. You can instruct your browser to refuse all cookies or to indicate when a cookie is being sent.' },
          { title: '6. Your Rights', content: 'You have the right to access, update, or delete the information we have on you. You can review and change your personal information by logging into your account settings.' },
          { title: '7. Contact Us', content: 'If you have any questions about this Privacy Policy, please contact us through the platform.' },
        ].map(section => (
          <div key={section.title} className="bg-[#0a0a0a] border border-[rgba(0,255,136,0.1)] rounded-[20px] p-6 mb-4">
            <h2 className="text-[#00ff88] text-lg mt-0 mb-3">{section.title}</h2>
            <p className="text-[#ccc] leading-relaxed m-0 text-sm">{section.content}</p>
          </div>
        ))}

        <div className="text-center mt-10">
          <Link href="/terms" className="text-[#00ff88] no-underline font-bold mr-4">Terms of Service</Link>
          <Link href="/about" className="text-[#00ff88] no-underline font-bold">About Us</Link>
        </div>
      </main>
    </div>
  );
}
