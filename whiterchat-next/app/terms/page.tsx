import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ background: '#000000', color: '#fff', fontFamily: "'Inter', -apple-system, system-ui, sans-serif', backgroundImage: 'radial-gradient(circle at 0% 0%, rgba(0,255,136,0.1) 0%, transparent 40%), radial-gradient(circle at 100% 100%, rgba(0,255,136,0.1) 0%, transparent 40%)'" }}>
      <header className="fixed top-0 w-full h-[80px] bg-[rgba(0,0,0,0.6)] backdrop-blur-[25px] flex items-center justify-between px-10 border-b border-[rgba(0,255,136,0.2)] z-[1000]">
        <div>
          <div className="text-2xl font-black text-[#00ff88] tracking-widest uppercase">WhiterChat</div>
          <div className="text-[10px] text-[#888] mt-[-5px]">Social Platform</div>
        </div>
        <Link href="/login" className="bg-[rgba(0,255,136,0.1)] text-[#00ff88] border border-[#00ff88] px-6 py-[10px] rounded-[50px] font-black cursor-pointer text-xs no-underline">Sign In</Link>
      </header>

      <div className="max-w-[1000px] mx-auto mt-[140px] mb-[100px] px-6">
        <div className="text-center mb-16">
          <h1 className="text-[#00ff88] text-4xl font-black mb-4">Terms of Service</h1>
          <p className="text-[#888] text-sm">Effective Date: January 1, 2026 | Last Updated: 2026</p>
        </div>

        {[
          { title: '1. Acceptance of Terms', content: 'By accessing or using WhiterChat, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use our services. We reserve the right to update these terms at any time.' },
          { title: '2. User Accounts', content: 'You must create an account to use most features of WhiterChat. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must provide accurate and complete information when creating your account.' },
          { title: '3. Acceptable Use', content: 'You agree not to use WhiterChat to post illegal content, harass other users, spread misinformation, or violate any applicable laws. We reserve the right to remove content and suspend accounts that violate these policies.' },
          { title: '4. Content Ownership', content: 'You retain ownership of content you post on WhiterChat. By posting content, you grant us a non-exclusive, royalty-free license to use, display, and distribute your content on our platform.' },
          { title: '5. Privacy', content: 'Your privacy is important to us. Please review our Privacy Policy to understand how we collect, use, and protect your information.' },
          { title: '6. Termination', content: 'We may terminate or suspend your account at any time for violations of these terms. You may also delete your account at any time through your account settings.' },
          { title: '7. Limitation of Liability', content: 'WhiterChat is provided "as is" without warranties of any kind. We are not liable for any damages arising from your use of our platform.' },
          { title: '8. Contact', content: 'If you have questions about these Terms of Service, please contact us through the platform.' },
        ].map(section => (
          <div key={section.title} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(0,255,136,0.2)] rounded-[24px] p-8 mb-4">
            <h2 className="text-[#00ff88] text-xl mt-0 mb-4">{section.title}</h2>
            <p className="text-[#ccc] leading-relaxed m-0">{section.content}</p>
          </div>
        ))}

        <div className="text-center mt-12">
          <Link href="/privacy" className="text-[#00ff88] no-underline font-bold mr-6">Privacy Policy</Link>
          <Link href="/about" className="text-[#00ff88] no-underline font-bold">About Us</Link>
        </div>
      </div>
    </div>
  );
}
