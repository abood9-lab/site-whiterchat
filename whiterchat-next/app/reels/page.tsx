'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, orderBy, getDocs, limit, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';

interface Reel {
  id: string;
  uid: string;
  username: string;
  userPhoto?: string;
  caption?: string;
  videoUrl: string;
  likes: string[];
}

export default function ReelsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [reels, setReels] = useState<Reel[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, 'reels'), orderBy('createdAt', 'desc'), limit(20))).then(snap => {
      setReels(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Reel, 'id'>) })));
    });
  }, [user]);

  const toggleLike = async (reel: Reel) => {
    if (!user) return;
    const liked = reel.likes.includes(user.uid);
    await updateDoc(doc(db, 'reels', reel.id), { likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid) });
    setReels(prev => prev.map(r => r.id === reel.id
      ? { ...r, likes: liked ? r.likes.filter(u => u !== user.uid) : [...r.likes, user.uid] }
      : r
    ));
  };

  if (loading) return <div className="fixed inset-0 bg-black flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  if (reels.length === 0) {
    return (
      <div className="bg-black text-white min-h-screen flex">
        <Navigation />
        <main className="md:ml-[280px] w-full flex items-center justify-center pt-[70px] md:pt-0">
          <div className="text-center">
            <div className="text-6xl mb-4">🎬</div>
            <h2 className="text-[#00ff88]">No Reels Yet</h2>
            <p className="text-[#555]">Post a video to see it here!</p>
            <button onClick={() => router.push('/create-post')} className="mt-4 bg-[#00ff88] text-black border-none px-6 py-3 rounded-[15px] font-bold cursor-pointer">Create Reel</button>
          </div>
        </main>
      </div>
    );
  }

  const reel = reels[current];
  const liked = user && reel ? reel.likes.includes(user.uid) : false;

  return (
    <div className="bg-black text-white min-h-screen flex">
      <Navigation />
      <main className="md:ml-[280px] w-full flex items-center justify-center pt-[70px] md:pt-0 pb-[80px] md:pb-0">
        <div className="relative w-full max-w-[400px] h-[80vh] bg-black rounded-[20px] overflow-hidden">
          {reel?.videoUrl && (
            <video src={reel.videoUrl} autoPlay loop muted playsInline className="w-full h-full object-cover" />
          )}
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black to-transparent">
            <div className="flex items-center gap-2 mb-2">
              <Image src={reel?.userPhoto || '/logo.png'} alt={reel?.username || ''} width={32} height={32} className="rounded-full border border-[#00ff88]" />
              <b>@{reel?.username}</b>
            </div>
            <p className="text-sm text-[#ccc]">{reel?.caption}</p>
          </div>
          <div className="absolute right-4 bottom-[120px] flex flex-col items-center gap-4">
            <button onClick={() => reel && toggleLike(reel)} className="bg-none border-none text-2xl cursor-pointer flex flex-col items-center gap-1">
              <span>{liked ? '❤️' : '🤍'}</span>
              <span className="text-xs">{reel?.likes.length}</span>
            </button>
          </div>
          <div className="absolute top-1/2 -translate-y-1/2 right-2 flex flex-col gap-2">
            {current > 0 && <button onClick={() => setCurrent(p => p - 1)} className="bg-[rgba(0,0,0,0.5)] text-white border-none rounded-full w-10 h-10 cursor-pointer text-lg">↑</button>}
            {current < reels.length - 1 && <button onClick={() => setCurrent(p => p + 1)} className="bg-[rgba(0,0,0,0.5)] text-white border-none rounded-full w-10 h-10 cursor-pointer text-lg">↓</button>}
          </div>
        </div>
      </main>
    </div>
  );
}
