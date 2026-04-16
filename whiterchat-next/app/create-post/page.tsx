'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? '';
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET ?? '';

interface FilePreview {
  file: File;
  url: string;
  isVideo: boolean;
}

export default function CreatePostPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [caption, setCaption] = useState('');
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise(resolve => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const objectUrl = URL.createObjectURL(file);
      video.onloadedmetadata = () => { URL.revokeObjectURL(objectUrl); resolve(video.duration); };
      video.src = objectUrl;
    });
  };

  const handleFiles = async (selected: FileList | null) => {
    if (!selected) return;
    const newFiles: FilePreview[] = [];
    for (const file of Array.from(selected)) {
      if (file.type.startsWith('video')) {
        const dur = await getVideoDuration(file);
        if (dur > 120) { showToast(`Video "${file.name}" too long! Max 2 min.`, 'error'); continue; }
      }
      if (files.length + newFiles.length < 10) {
        newFiles.push({ file, url: URL.createObjectURL(file), isVideo: file.type.startsWith('video') });
      }
    }
    setFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const publish = async () => {
    if (!user) return;
    if (!caption.trim() && files.length === 0) {
      showToast('Write something or select a file.', 'error');
      return;
    }
    setPublishing(true);

    try {
      const uploadedUrls: string[] = [];
      let hasVideo = false;

      for (let i = 0; i < files.length; i++) {
        const { file, isVideo } = files[i];
        if (isVideo) hasVideo = true;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', UPLOAD_PRESET);
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.secure_url) uploadedUrls.push(data.secure_url);
        setProgress(((i + 1) / files.length) * 100);
      }

      const collectionName = hasVideo ? 'reels' : 'posts';
      await addDoc(collection(db, collectionName), {
        uid: user.uid,
        username: user.displayName || 'Whiter User',
        userPhoto: user.photoURL || '',
        caption: caption.trim(),
        [hasVideo ? 'videoUrl' : 'images']: hasVideo ? uploadedUrls[0] : uploadedUrls,
        type: hasVideo ? 'video' : uploadedUrls.length > 0 ? 'image' : 'text',
        createdAt: serverTimestamp(),
        likes: [],
        commentsCount: 0,
      });

      showToast('Published successfully! 🎉');
      setTimeout(() => router.replace(hasVideo ? '/reels' : '/feed'), 1500);
    } catch {
      showToast('Error publishing. Please try again.', 'error');
      setPublishing(false);
    }
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="bg-[#020b10] text-white min-h-screen flex">
      <Toast toasts={toasts} />
      <Navigation />
      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-10 px-5 pb-[100px] md:pb-10 flex items-center justify-center">
        <div className="w-full max-w-[450px] bg-[rgba(10,25,30,0.85)] backdrop-blur-[20px] border border-[rgba(0,255,136,0.2)] rounded-[30px] p-[25px] shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          <h2 className="mt-0 text-[#00ff88]">New Post</h2>

          <div className="bg-[rgba(0,0,0,0.4)] rounded-[18px] p-4 mb-4 border border-[rgba(255,255,255,0.05)]">
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="What's on your mind? (Text posts allowed)"
              rows={4}
              className="w-full bg-transparent border-none text-white resize-none outline-none text-left text-base"
            />
          </div>

          <div
            className="border-2 border-dashed border-[#00ff88] rounded-[20px] p-5 cursor-pointer mb-4 text-center hover:bg-[rgba(0,255,136,0.05)] transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" hidden multiple accept="image/*,video/*" onChange={e => handleFiles(e.target.files)} />
            <div className="text-[35px] text-[#00ff88]">📷</div>
            <p className="m-[10px_0_0]">Add Media (Optional)</p>
            <div className="text-[11px] text-[#888]">Photos or Videos (Max 2 mins per video)</div>
          </div>

          {files.length > 0 && (
            <div className="flex gap-[10px] overflow-x-auto py-[10px] mb-4" style={{ scrollbarWidth: 'none' }}>
              {files.map((f, i) => (
                <div key={i} className="relative min-w-[90px] h-[90px] rounded-xl border border-[#00ff88] overflow-hidden flex-shrink-0">
                  <button onClick={() => removeFile(i)} className="absolute top-[2px] right-[2px] bg-[#ff4757] text-white border-none rounded-full w-[20px] h-[20px] text-xs cursor-pointer z-10">×</button>
                  {f.isVideo
                    ? <video src={f.url} className="w-full h-full object-cover" />
                    : <Image src={f.url} alt="preview" fill className="object-cover" />
                  }
                </div>
              ))}
            </div>
          )}

          {publishing && (
            <div className="bg-[rgba(255,255,255,0.1)] rounded-[10px] mb-4 h-[8px] overflow-hidden">
              <div className="h-full bg-[#00ff88] transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          <button
            onClick={publish}
            disabled={publishing}
            className="w-full bg-[#00ff88] text-black border-none p-[16px] rounded-[15px] font-black cursor-pointer text-[17px] disabled:bg-[#333] disabled:text-[#777] disabled:cursor-not-allowed transition-all"
          >
            {publishing ? '⏳ Publishing...' : 'Publish Now'}
          </button>
        </div>
      </main>
    </div>
  );
}
