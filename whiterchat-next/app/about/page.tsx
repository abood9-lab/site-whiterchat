import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="m-0 min-h-screen" style={{ fontFamily: 'Arial, sans-serif', background: '#0b0f12', color: 'white' }}>
      <div className="max-w-[900px] mx-auto px-5 py-10">
        <div className="text-center mb-10">
          <div className="text-[34px] font-bold text-[#00ff88] tracking-widest">WhiterChat</div>
          <h1 className="text-[#00ff88] mb-[10px]">من نحن</h1>
          <p className="text-[#ccc] leading-relaxed">منصة تواصل اجتماعي حديثة تهدف إلى ربط الناس ومشاركة اللحظات بطريقة بسيطة وسريعة.</p>
        </div>

        <div className="bg-[#11181d] p-5 rounded-[15px] mt-5 border border-[rgba(0,255,136,0.1)]">
          <h2 className="text-[#00ff88]">قصتنا</h2>
          <p className="text-[#ccc] leading-relaxed">
            تم إنشاء WhiterChat لتوفير تجربة تواصل اجتماعي جديدة تركز على البساطة والسرعة،
            حيث يمكن للمستخدمين مشاركة الصور والمنشورات والتفاعل مع الأصدقاء بسهولة.
          </p>
        </div>

        <div className="bg-[#11181d] p-5 rounded-[15px] mt-5 border border-[rgba(0,255,136,0.1)]">
          <h2 className="text-[#00ff88]">مميزات المنصة</h2>
          <div className="grid gap-4 mt-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {[
              { title: 'نشر سريع', desc: 'شارك صورك ومنشوراتك في ثوانٍ.' },
              { title: 'تفاعل فوري', desc: 'إعجابات وتعليقات مباشرة بين المستخدمين.' },
              { title: 'ملفات شخصية', desc: 'أنشئ حسابك وعرّف نفسك للعالم.' },
              { title: 'تصميم حديث', desc: 'واجهة بسيطة وسريعة تناسب جميع الأجهزة.' },
            ].map(f => (
              <div key={f.title} className="bg-[#0f151a] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                <h3 className="text-[#00ff88] m-0 mb-2 text-sm">{f.title}</h3>
                <p className="text-[#ccc] text-sm m-0">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#11181d] p-5 rounded-[15px] mt-5 border border-[rgba(0,255,136,0.1)] text-center">
          <h2 className="text-[#00ff88]">ابدأ الآن</h2>
          <p className="text-[#ccc]">انضم إلى WhiterChat وابدأ مشاركة لحظاتك مع الآخرين.</p>
          <Link href="/login" className="inline-block mt-6 px-5 py-3 bg-[#00ff88] text-black rounded-[10px] no-underline font-bold">الدخول إلى المنصة</Link>
        </div>

        <footer className="text-center mt-12 text-[#666] text-sm">
          © 2026 WhiterChat - جميع الحقوق محفوظة
        </footer>
      </div>
    </div>
  );
}
