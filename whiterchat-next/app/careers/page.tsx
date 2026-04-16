'use client';
import { useState } from 'react';
import Link from 'next/link';

const jobs = [
  { title: 'مطور Frontend', desc: 'تطوير واجهات مستخدم احترافية باستخدام React وNext.js', tags: ['React', 'TypeScript', 'Tailwind'] },
  { title: 'مطور Backend', desc: 'بناء APIs وخدمات خلفية باستخدام Node.js وFirebase', tags: ['Node.js', 'Firebase', 'REST API'] },
  { title: 'مصمم UI/UX', desc: 'تصميم تجارب مستخدم مبتكرة وجذابة', tags: ['Figma', 'Design', 'UX'] },
  { title: 'مسوق رقمي', desc: 'إدارة حملات التسويق الرقمي وتنمية المجتمع', tags: ['Marketing', 'Social Media', 'Analytics'] },
];

export default function CareersPage() {
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!form.name || !form.email) return;
    setSubmitted(true);
    setTimeout(() => { setSubmitted(false); setSelectedJob(null); setForm({ name: '', email: '', message: '' }); }, 3000);
  };

  return (
    <div className="min-h-screen" style={{ background: '#050505', color: '#fff', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <header className="fixed top-0 w-full h-[75px] bg-[rgba(0,0,0,0.8)] backdrop-blur-[25px] flex items-center justify-between px-6 border-b border-[rgba(0,255,136,0.3)] z-[1000]">
        <div className="text-[22px] font-black text-[#00ff88] tracking-wide">Whiterchat</div>
        <Link href="/login" className="bg-[rgba(0,255,136,0.1)] text-[#00ff88] border border-[#00ff88] px-4 py-[7px] rounded-[50px] cursor-pointer text-xs font-bold no-underline">Sign In</Link>
      </header>

      <div className="max-w-[1000px] mx-auto px-5 pt-[95px] pb-10">
        <h1 className="text-center text-[#00ff88] text-3xl font-black mb-2">Careers at Whiterchat</h1>
        <p className="text-center text-[#888] mb-8">Join our team and help build the future of social media</p>

        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {jobs.map(job => (
            <div
              key={job.title}
              className="h-[300px] rounded-[30px] relative overflow-hidden border border-[rgba(255,255,255,0.1)] flex items-end cursor-pointer transition-transform hover:scale-[1.02] hover:border-[#00ff88]"
              style={{ background: 'linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,0,0,0.9))' }}
              onClick={() => setSelectedJob(job.title)}
            >
              <div className="w-full p-8 bg-gradient-to-t from-black to-transparent backdrop-blur-[5px]">
                <h3 className="text-2xl m-0 mb-[10px] text-[#00ff88]">{job.title}</h3>
                <p className="text-sm text-[#ccc] m-0 leading-relaxed">{job.desc}</p>
                <div className="flex gap-2 flex-wrap mt-3">
                  {job.tags.map(tag => <span key={tag} className="bg-[rgba(0,255,136,0.2)] text-[#00ff88] px-3 py-1 rounded-full text-xs font-bold">{tag}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedJob && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.92)] flex justify-center items-center z-[2000] p-5">
          <div className="bg-[#0f0f0f] border border-[rgba(0,255,136,0.3)] w-full max-w-[500px] p-10 rounded-[35px] relative">
            <button onClick={() => setSelectedJob(null)} className="absolute top-4 right-4 bg-none border-none text-[#555] cursor-pointer text-2xl">✕</button>
            <h3 className="text-[#00ff88] mt-0 mb-6">Apply: {selectedJob}</h3>
            {submitted ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-[#00ff88]">Application Sent!</h3>
                <p className="text-[#888]">We&apos;ll contact you soon.</p>
              </div>
            ) : (
              <>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Your Name"
                  className="w-full bg-[#1a1a1a] border border-[#333] p-[16px] rounded-[15px] text-white mb-4 outline-none focus:border-[#00ff88]"
                />
                <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Your Email" type="email"
                  className="w-full bg-[#1a1a1a] border border-[#333] p-[16px] rounded-[15px] text-white mb-4 outline-none focus:border-[#00ff88]"
                />
                <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))} placeholder="Why do you want to join?" rows={4}
                  className="w-full bg-[#1a1a1a] border border-[#333] p-[16px] rounded-[15px] text-white mb-4 outline-none resize-none focus:border-[#00ff88]"
                />
                <button onClick={handleSubmit} className="bg-[#00ff88] text-black border-none p-[18px] rounded-[18px] font-black w-full cursor-pointer text-base">Submit Application</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
