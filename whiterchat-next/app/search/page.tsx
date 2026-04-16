'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, getDocs, orderBy, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';

interface UserResult {
  uid: string;
  username?: string;
  photoURL?: string;
  fullname?: string;
}

interface PostItem {
  id: string;
  images?: string[];
  imageUrl?: string;
  uid?: string;
  username?: string;
  userPhoto?: string;
  caption?: string;
  likes?: string[];
}

export default function SearchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [explorePosts, setExplorePosts] = useState<PostItem[]>([]);
  const [selectedPost, setSelectedPost] = useState<PostItem | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    loadExplorePosts();
  }, [user]);

  const loadExplorePosts = async () => {
    const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)));
    setExplorePosts(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PostItem, 'id'>) })));
  };

  const searchUsers = useCallback(async (val: string) => {
    setSearchInput(val);
    if (val.length < 2) { setUserResults([]); return; }
    const snap = await getDocs(collection(db, 'users'));
    const results: UserResult[] = snap.docs
      .map(d => ({ uid: d.id, ...(d.data() as Omit<UserResult, 'uid'>) }))
      .filter(u => (u.username || '').toLowerCase().includes(val.toLowerCase()) || (u.fullname || '').toLowerCase().includes(val.toLowerCase()))
      .slice(0, 10);
    setUserResults(results);
  }, []);

  const openPost = async (post: PostItem) => {
    setSelectedPost(post);
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  const images = Array.isArray(selectedPost?.images) ? selectedPost.images : (selectedPost?.imageUrl ? [selectedPost.imageUrl] : []);

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex">
      <Navigation />
      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-10 px-3 pb-[100px] md:pb-10 flex flex-col items-center">
        <div className="w-full max-w-[935px]">
          {/* Search Box */}
          <div className="bg-[rgba(15,30,35,0.95)] border border-[rgba(0,255,136,0.2)] rounded-xl px-4 py-[10px] flex items-center gap-[10px] mb-6">
            <span className="text-[#00ff88]">🔍</span>
            <input
              type="text"
              value={searchInput}
              onChange={e => searchUsers(e.target.value)}
              placeholder="Search for people..."
              className="flex-1 bg-none border-none text-white outline-none text-base"
            />
          </div>

          {/* User Results */}
          {userResults.length > 0 && (
            <div className="mb-6">
              {userResults.map(u => (
                <div key={u.uid} className="flex items-center gap-3 p-3 cursor-pointer bg-[rgba(255,255,255,0.03)] rounded-[18px] mb-2 hover:bg-[rgba(0,255,136,0.05)] transition-all"
                  onClick={() => router.push(`/profile?uid=${u.uid}`)}
                >
                  <Image src={u.photoURL || '/logo.png'} alt={u.username || 'User'} width={40} height={40} className="w-[40px] h-[40px] rounded-full border border-[#00ff88] object-cover" />
                  <div>
                    <b className="text-[#00ff88]">@{u.username}</b>
                    <div className="text-[13px] text-[#888]">{u.fullname}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Explore Grid */}
          {!searchInput && <h3 className="m-0 mb-4 text-[#00ff88] text-lg font-bold ml-1">Explore</h3>}
          <div className="grid grid-cols-3 gap-1">
            {explorePosts.map(post => {
              const thumb = Array.isArray(post.images) ? post.images[0] : post.imageUrl;
              if (!thumb) return null;
              return (
                <div key={post.id} className="aspect-square relative overflow-hidden cursor-pointer bg-[#051014] rounded-1" onClick={() => openPost(post)}>
                  <Image src={thumb} alt="post" fill className="object-cover transition-all hover:brightness-80" />
                  {Array.isArray(post.images) && post.images.length > 1 && (
                    <span className="absolute top-[10px] right-[10px] text-white text-lg filter drop-shadow-md">⧉</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Post Overlay */}
      {selectedPost && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.85)] z-[3000] flex justify-center items-center backdrop-blur-[5px]" onClick={e => { if (e.target === e.currentTarget) setSelectedPost(null); }}>
          <div className="bg-black w-[95%] max-w-[1100px] h-[90vh] md:flex rounded-[8px] overflow-hidden border border-[#333] relative">
            <button onClick={() => setSelectedPost(null)} className="absolute top-[15px] right-[15px] md:top-[-40px] md:right-[-40px] text-white text-[30px] cursor-pointer bg-none border-none z-[3100]">✕</button>
            <div className="flex-1 bg-black flex items-center justify-center border-b md:border-b-0 md:border-r border-[#222]">
              {images.length > 0 && (
                <div className="flex overflow-x-auto snap-x snap-mandatory w-full h-full">
                  {images.map((img, i) => (
                    <div key={i} className="min-w-full w-full flex-shrink-0 snap-start flex items-center justify-center">
                      <Image src={img} alt="post" fill className="object-contain" />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col bg-black max-w-full md:max-w-[400px] w-full">
              <div className="p-4 border-b border-[#222] flex items-center gap-3 cursor-pointer" onClick={() => { router.push(`/profile?uid=${selectedPost.uid}`); setSelectedPost(null); }}>
                <Image src={selectedPost.userPhoto || '/logo.png'} alt={selectedPost.username || ''} width={32} height={32} className="rounded-full border border-[#00ff88] object-cover" />
                <b>{selectedPost.username}</b>
              </div>
              <div className="p-4 flex-1 overflow-y-auto text-sm leading-relaxed text-[#efefef]">{selectedPost.caption}</div>
              <div className="p-4 border-t border-[#222] text-xs text-[#555]">{(selectedPost.likes || []).length} likes</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
