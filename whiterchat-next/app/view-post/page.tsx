'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';
import Link from 'next/link';

interface Post {
  id: string;
  uid: string;
  username: string;
  userPhoto?: string;
  caption?: string;
  images?: string[];
  imageUrl?: string;
  likes: string[];
  createdAt?: { toDate: () => Date } | null;
}

interface Comment {
  id: string;
  uid: string;
  username: string;
  text: string;
  createdAt?: { toDate: () => Date } | null;
}

function ViewPostContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const postId = searchParams.get('id') || '';
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!postId) return;
    getDoc(doc(db, 'posts', postId)).then(snap => {
      if (snap.exists()) setPost({ id: snap.id, ...(snap.data() as Omit<Post, 'id'>) });
    });
    const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc'));
    onSnapshot(q, snap => setComments(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) }))));
  }, [postId]);

  const sendComment = async () => {
    if (!commentInput.trim() || !user || !postId) return;
    await addDoc(collection(db, 'posts', postId, 'comments'), {
      text: commentInput, username: user.displayName || 'User', uid: user.uid, createdAt: serverTimestamp(),
    });
    setCommentInput('');
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user || !post) return null;

  const images = Array.isArray(post.images) ? post.images : (post.imageUrl ? [post.imageUrl] : []);

  return (
    <div className="bg-[#01080b] text-white min-h-screen pb-[80px]">
      <header className="fixed top-0 left-0 w-full h-[60px] bg-[rgba(1,8,11,0.9)] backdrop-blur-lg border-b border-[rgba(0,255,136,0.2)] flex items-center px-5 z-[2500] gap-4">
        <button onClick={() => router.back()} className="bg-none border-none text-[#00ff88] cursor-pointer text-xl">←</button>
        <span className="font-bold">Post</span>
      </header>
      <main className="pt-[70px] px-4 max-w-[600px] mx-auto">
        <div className="bg-[rgba(15,30,35,0.9)] rounded-[30px] border border-[rgba(0,255,136,0.2)] p-4 mb-5">
          <Link href={`/profile?uid=${post.uid}`} className="flex items-center gap-[10px] no-underline text-white mb-3">
            <Image src={post.userPhoto || '/logo.png'} alt={post.username} width={38} height={38} className="rounded-full border border-[#00ff88] object-cover" />
            <b>{post.username}</b>
          </Link>
          {images.length > 0 && (
            <div className="flex overflow-x-auto snap-x mb-3" style={{ scrollbarWidth: 'none' }}>
              {images.map((img, i) => <Image key={i} src={img} alt="post" width={500} height={500} className="min-w-full aspect-square object-cover snap-start rounded-[20px]" />)}
            </div>
          )}
          {post.caption && <p className="text-sm text-[#eee]">{post.caption}</p>}
          <div className="text-[13px] text-[#888] mt-2">{post.likes.length} likes</div>
        </div>

        <h3 className="text-[#00ff88] mb-3">Comments</h3>
        {comments.map(c => (
          <div key={c.id} className="bg-[rgba(255,255,255,0.05)] p-3 rounded-xl mb-2">
            <b className="text-[#00ff88] text-xs">{c.username}</b>
            <p className="text-sm mt-1 mb-0">{c.text}</p>
          </div>
        ))}
        <div className="flex gap-[10px] mt-4">
          <input type="text" value={commentInput} onChange={e => setCommentInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendComment()}
            placeholder="Add a comment..." className="flex-1 bg-[#111] border border-[rgba(0,255,136,0.2)] rounded-xl text-white p-3 outline-none"
          />
          <button onClick={sendComment} className="bg-[#00ff88] border-none rounded-xl px-4 cursor-pointer text-black font-bold">Send</button>
        </div>
      </main>
    </div>
  );
}

export default function ViewPostPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>}>
      <ViewPostContent />
    </Suspense>
  );
}
