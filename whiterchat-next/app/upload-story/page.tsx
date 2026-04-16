'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';

const CLOUD_NAME = 'dt5pdj978';
const UPLOAD_PRESET = 'raneem';

export default function UploadStoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const uploadStory = async () => {
    if (!file || !user) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', UPLOAD_PRESET);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      await addDoc(collection(db, 'stories'), {
        uid: user.uid, username: user.displayName || 'User',
        userPhoto: user.photoURL, imageUrl: data.secure_url,
        createdAt: serverTimestamp(),
      });
      showToast('Story uploaded! 🎉');
      setTimeout(() => router.replace('/feed'), 1500);
    } catch {
      showToast('Upload failed', 'error');
      setUploading(false);
    }
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex flex-col items-center justify-center p-5">
      <Toast toasts={toasts} />
      <div className="w-full max-w-[400px] bg-[rgba(15,30,35,0.9)] rounded-[30px] border border-[rgba(0,255,136,0.2)] p-6 text-center">
        <h2 className="text-[#00ff88] mt-0 mb-6">Upload Story</h2>

        {preview ? (
          <div className="relative w-full aspect-[9/16] max-h-[400px] rounded-[20px] overflow-hidden mb-5">
            <img src={preview} alt="preview" className="w-full h-full object-cover" />
            <button onClick={() => { setPreview(null); setFile(null); }} className="absolute top-3 right-3 bg-[rgba(0,0,0,0.7)] text-white border-none rounded-full w-8 h-8 cursor-pointer text-sm">✕</button>
          </div>
        ) : (
          <div
            className="border-2 border-dashed border-[#00ff88] rounded-[20px] p-10 cursor-pointer mb-5 hover:bg-[rgba(0,255,136,0.05)] transition-all"
            onClick={() => inputRef.current?.click()}
          >
            <div className="text-5xl mb-3">📸</div>
            <p className="text-[#555] m-0">Tap to select a photo or video</p>
          </div>
        )}

        <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        {file && (
          <button onClick={uploadStory} disabled={uploading}
            className="w-full bg-[#00ff88] text-black border-none p-[16px] rounded-[15px] font-black cursor-pointer text-[17px] disabled:opacity-40"
          >
            {uploading ? '⏳ Uploading...' : 'Share Story'}
          </button>
        )}

        <button onClick={() => router.back()} className="mt-4 bg-none border-none text-[#555] cursor-pointer w-full">Cancel</button>
      </div>
    </div>
  );
}
