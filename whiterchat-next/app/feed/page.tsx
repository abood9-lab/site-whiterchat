'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, orderBy, limit, getDocs, doc, updateDoc,
  arrayUnion, arrayRemove, addDoc, serverTimestamp, getDoc,
  deleteDoc, where, startAfter, onSnapshot,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';

const ADMIN_UIDS = ['2UHMnft6wiOrq33P7DEyD0ViioQ2', 'EOM6zBVb17euGJAHM4jYFDSXQt52', 'YkIWutRh9GbgQTqOHLKEBgyDXue2', 'cuCuQxaFhYdgwBRpKCjCQ2Hgsi33'];

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

interface Story {
  id: string;
  uid: string;
  username: string;
  imageUrl: string;
}

interface Comment {
  id: string;
  uid: string;
  username: string;
  text: string;
  replyTo?: string | null;
}

export default function FeedPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyUser, setReplyUser] = useState('');
  const [commentSheetOpen, setCommentSheetOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareList, setShareList] = useState<{ uid: string; chatId: string }[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [following, setFollowing] = useState<string[]>([]);
  const lastVisibleRef = useRef<DocumentSnapshot | null>(null);
  const isFetchingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setIsAdmin(ADMIN_UIDS.includes(user.uid));
    getDoc(doc(db, 'users', user.uid)).then(snap => {
      setFollowing(snap.data()?.following || []);
    });
    loadPosts(true);
    loadStories();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadPosts = useCallback(async (isInitial = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    let q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(10));
    if (!isInitial && lastVisibleRef.current) {
      q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), startAfter(lastVisibleRef.current), limit(10));
    }
    const snap = await getDocs(q);
    if (!snap.empty) {
      lastVisibleRef.current = snap.docs[snap.docs.length - 1];
      const newPosts: Post[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Post, 'id'>) }));
      setPosts(prev => isInitial ? newPosts : [...prev, ...newPosts]);
    }
    isFetchingRef.current = false;
  }, []);

  const loadStories = useCallback(() => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    onSnapshot(query(collection(db, 'stories'), where('createdAt', '>', yesterday)), snap => {
      const s: Story[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Story, 'id'>) }));
      setStories(s);
    });
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !isFetchingRef.current) loadPosts();
    }, { threshold: 0.5 });
    if (sentinelRef.current) obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [loadPosts]);

  const toggleLike = async (postId: string, likes: string[]) => {
    if (!user) return;
    const liked = likes.includes(user.uid);
    await updateDoc(doc(db, 'posts', postId), {
      likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid),
    });
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, likes: liked ? p.likes.filter(u => u !== user.uid) : [...p.likes, user.uid] }
      : p
    ));
  };

  const openComments = (postId: string) => {
    setActivePostId(postId);
    setReplyToId(null);
    setReplyUser('');
    setCommentSheetOpen(true);
    onSnapshot(query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc')), snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Comment, 'id'>) })));
    });
  };

  const sendComment = async () => {
    if (!commentInput.trim() || !activePostId || !user) return;
    await addDoc(collection(db, 'posts', activePostId, 'comments'), {
      text: commentInput, username: user.displayName || 'User',
      createdAt: serverTimestamp(), replyTo: replyToId, uid: user.uid,
    });
    setCommentInput('');
    setReplyToId(null);
    setReplyUser('');
  };

  const handleRepost = async (postId: string) => {
    if (!user) return;
    const snap = await getDoc(doc(db, 'posts', postId));
    if (snap.exists()) {
      await addDoc(collection(db, 'posts'), {
        ...snap.data(), uid: user.uid, username: user.displayName,
        createdAt: serverTimestamp(), likes: [],
      });
      showToast('Reposted!');
    }
  };

  const openShareSheet = (postId: string) => {
    setActivePostId(postId);
    setShareSheetOpen(true);
    if (!user) return;
    onSnapshot(query(collection(db, 'chats'), where('participants', 'array-contains', user.uid)), snap => {
      const list = snap.docs.map(d => ({
        uid: (d.data().participants as string[]).find(u => u !== user.uid) || '',
        chatId: d.id,
      })).filter(x => x.uid);
      setShareList(list);
    });
  };

  const sendPostToUser = async (toUid: string) => {
    if (!user || !activePostId) return;
    await addDoc(collection(db, 'chats'), {
      sender: user.uid, receiver: toUid,
      participants: [user.uid, toUid], postId: activePostId,
      type: 'share_post', createdAt: serverTimestamp(),
    });
    showToast('Sent!');
    closeAll();
  };

  const postAction = async (pid: string, uid: string, cap: string) => {
    const myAdmin = isAdmin && uid !== user?.uid;
    const op = window.prompt(myAdmin ? '1. Delete\n2. Ban' : '1. Delete\n2. Edit');
    if (op === '1') {
      if (window.confirm('Delete?')) {
        await deleteDoc(doc(db, 'posts', pid));
        setPosts(prev => prev.filter(p => p.id !== pid));
      }
    }
    if (op === '2' && myAdmin) {
      await updateDoc(doc(db, 'users', uid), { isBanned: true });
    }
    if (op === '2' && !myAdmin) {
      const nt = window.prompt('New caption:', cap);
      if (nt) await updateDoc(doc(db, 'posts', pid), { caption: nt });
    }
  };

  const closeAll = () => {
    setCommentSheetOpen(false);
    setShareSheetOpen(false);
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex">
      <Toast toasts={toasts} />
      <Navigation />

      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-10 px-3 pb-[100px] md:pb-10 flex flex-col items-center">
        <div className="w-full max-w-[500px]">
          {/* Stories */}
          <div className="flex gap-4 overflow-x-auto pb-5 scrollbar-none mb-2" style={{ scrollbarWidth: 'none' }}>
            <div className="min-w-[70px] text-center cursor-pointer" onClick={() => router.push('/upload-story')}>
              <div className="w-[65px] h-[65px] rounded-full bg-[#222] flex items-center justify-center border-2 border-dashed border-[#00ff88] mx-auto">
                <span className="text-[#00ff88] text-2xl">+</span>
              </div>
              <span className="text-[11px]">Your Story</span>
            </div>
            {stories.filter(s => following.includes(s.uid) || s.uid === user.uid).map(s => (
              <div key={s.id} className="min-w-[70px] text-center">
                <div className="w-[65px] h-[65px] rounded-full p-[2px] mx-auto" style={{ background: 'linear-gradient(45deg, #00ff88, #00d4ff)' }}>
                  <Image src={s.imageUrl} alt={s.username} width={65} height={65} className="w-full h-full rounded-full border-2 border-black object-cover" />
                </div>
                <span className="text-[11px]">{s.username}</span>
              </div>
            ))}
          </div>

          {/* Posts */}
          {posts.map(p => {
            const liked = p.likes.includes(user.uid);
            const images = Array.isArray(p.images) ? p.images : (p.imageUrl ? [p.imageUrl] : []);
            const postIsAdmin = ADMIN_UIDS.includes(p.uid);
            return (
              <div key={p.id} className="bg-[rgba(15,30,35,0.9)] rounded-[30px] border border-[rgba(0,255,136,0.2)] p-[15px] mb-5">
                <div className="flex justify-between items-center">
                  <Link href={`/profile?uid=${p.uid}`} className="flex items-center gap-[10px] no-underline text-white">
                    <Image src={p.userPhoto || '/logo.png'} alt={p.username} width={38} height={38} className="rounded-full border border-[#00ff88] object-cover" />
                    <b className="text-sm">{p.username} {postIsAdmin && <span className="bg-[#ff4757] text-white text-[10px] px-[6px] py-[2px] rounded-[5px] ml-[5px] font-bold">ADMIN</span>}</b>
                  </Link>
                  {(p.uid === user.uid || isAdmin) && (
                    <button onClick={() => postAction(p.id, p.uid, p.caption || '')} className="cursor-pointer p-[5px] bg-none border-none text-white">⋯</button>
                  )}
                </div>

                {images.length > 0 ? (
                  <div className="relative w-full rounded-[20px] my-[10px] overflow-hidden bg-[#050a0c]">
                    {images.length > 1 && <div className="absolute top-3 left-3 bg-[rgba(0,0,0,0.6)] text-white px-[10px] py-1 rounded-xl text-[11px] z-[5]">1/{images.length}</div>}
                    <div className="flex overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
                      {images.map((img, i) => (
                        <Image key={i} src={img} alt="post" width={500} height={500} className="min-w-full aspect-square object-cover snap-start" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-[30px_15px] text-lg text-center rounded-[20px] border border-[rgba(0,255,136,0.2)] my-[10px]" style={{ background: 'linear-gradient(145deg, rgba(0,255,136,0.05), rgba(0,0,0,0.2))' }}>
                    {p.caption}
                  </div>
                )}

                <div className="flex gap-[22px] text-[#00ff88] text-2xl py-3">
                  <button onClick={() => toggleLike(p.id, p.likes)} className="bg-none border-none cursor-pointer text-2xl" style={{ color: liked ? '#ff4757' : '#00ff88' }}>
                    {liked ? '❤️' : '🤍'}
                  </button>
                  <button onClick={() => openComments(p.id)} className="bg-none border-none cursor-pointer text-2xl">💬</button>
                  <button onClick={() => handleRepost(p.id)} className="bg-none border-none cursor-pointer text-2xl">🔄</button>
                  <button onClick={() => openShareSheet(p.id)} className="bg-none border-none cursor-pointer text-2xl">📤</button>
                </div>
                <div className="text-[13px] text-[#888]">{p.likes.length} likes</div>
                {images.length > 0 && p.caption && <div className="text-sm mt-[5px]"><b>{p.username}</b> {p.caption}</div>}
              </div>
            );
          })}

          <div ref={sentinelRef} className="h-[80px] flex justify-center items-center text-[#00ff88] text-sm w-full">
            Loading posts...
          </div>
        </div>
      </main>

      {/* Overlay */}
      {(commentSheetOpen || shareSheetOpen) && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.7)] z-[2900]" onClick={closeAll} />
      )}

      {/* Comment Sheet */}
      <div className={`fixed left-0 w-full h-[85vh] bg-[#050a0c] rounded-[30px_30px_0_0] z-[3000] transition-all duration-500 p-5 border-t-2 border-[#00ff88] flex flex-col pb-[calc(20px+env(safe-area-inset-bottom))] ${commentSheetOpen ? 'bottom-0' : 'bottom-[-100%]'}`}>
        <div className="w-[40px] h-[4px] bg-[#333] mx-auto mb-4 rounded-[10px] cursor-pointer" onClick={closeAll} />
        <div className="flex-1 overflow-y-auto">
          {comments.map(c => (
            <div key={c.id} className={`bg-[rgba(255,255,255,0.05)] p-3 rounded-[15px] mb-3 ${c.replyTo ? 'ml-9 border-l-2 border-[#00ff88]' : ''}`}>
              <b className="text-[#00ff88] text-xs">{c.username} {ADMIN_UIDS.includes(c.uid) && <span className="bg-[#ff4757] text-white text-[10px] px-[6px] py-[2px] rounded-[5px] ml-[5px]">ADMIN</span>}</b>
              <div className="text-[13px] my-1">{c.text}</div>
              <div className="text-[10px] text-[#888] cursor-pointer" onClick={() => { setReplyToId(c.id); setReplyUser(c.username); }}>Reply</div>
            </div>
          ))}
        </div>
        {replyUser && (
          <div className="p-[10px] bg-[rgba(0,255,136,0.1)] text-[#00ff88] rounded-[10px] mb-[5px] flex justify-between">
            <span>Replying to {replyUser}</span>
            <button onClick={() => { setReplyToId(null); setReplyUser(''); }} className="bg-none border-none text-white cursor-pointer">✕</button>
          </div>
        )}
        <div className="flex gap-[10px] pt-[10px]">
          <input
            type="text" value={commentInput} onChange={e => setCommentInput(e.target.value)}
            placeholder="Add a comment..." onKeyDown={e => e.key === 'Enter' && sendComment()}
            className="flex-1 bg-[#111] border border-[rgba(0,255,136,0.2)] rounded-[15px] text-white p-3 outline-none"
          />
          <button onClick={sendComment} className="bg-[#00ff88] border-none rounded-[15px] px-4 py-[10px] cursor-pointer">➤</button>
        </div>
      </div>

      {/* Share Sheet */}
      <div className={`fixed left-0 w-full h-[85vh] bg-[#050a0c] rounded-[30px_30px_0_0] z-[3000] transition-all duration-500 p-5 border-t-2 border-[#00ff88] flex flex-col pb-[calc(20px+env(safe-area-inset-bottom))] ${shareSheetOpen ? 'bottom-0' : 'bottom-[-100%]'}`}>
        <div className="w-[40px] h-[4px] bg-[#333] mx-auto mb-4 rounded-[10px] cursor-pointer" onClick={closeAll} />
        <h3 className="text-center text-white mb-4">Send to</h3>
        <div className="flex-1 overflow-y-auto">
          {shareList.length === 0 && <p className="text-center text-[#555]">No chats found</p>}
          {shareList.map(item => (
            <div key={item.chatId} className="flex justify-between items-center mb-[10px] bg-[#111] p-[10px] rounded-[10px]">
              <span className="text-white">User: {item.uid.substring(0, 6)}</span>
              <button onClick={() => sendPostToUser(item.uid)} className="bg-[#00ff88] border-none px-[10px] py-[5px] rounded-[5px] cursor-pointer text-black font-bold">Send</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
