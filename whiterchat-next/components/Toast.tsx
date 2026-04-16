'use client';
interface ToastItem { id: number; message: string; type: 'success' | 'error'; }

export default function Toast({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[10000] w-[90%] max-w-[350px] pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`bg-[#1a1a1a] text-white px-5 py-4 rounded-xl mb-2.5 text-sm text-center border-l-4 shadow-xl animate-slide-down ${t.type === 'error' ? 'border-[#ff4d4d]' : 'border-[#00ff88]'}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
