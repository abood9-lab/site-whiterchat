'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';

interface Notification {
  id: string;
  targetUid: string;
  fromUid: string;
  fromName: string;
  fromPhoto?: string;
  type: string;
  isRead: boolean;
  storyImg?: string;
  createdAt?: { toDate: () => Date } | null;
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'),
      where('targetUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Notification, 'id'>) })));
      setFetching(false);
    });
    return unsub;
  }, [user]);

  const markAsRead = async (id: string, fromUid: string) => {
    await updateDoc(doc(db, 'notifications', id), { isRead: true });
    router.push(`/profile?uid=${fromUid}`);
  };

  const getMsg = (type: string) => {
    if (type === 'follow') return 'started following you.';
    if (type === 'like_post' || type === 'like_story') return 'liked your post/story.';
    if (type === 'comment') return 'commented on your post.';
    return 'interacted with you.';
  };

  const getIcon = (type: string) => {
    if (type === 'follow') return '👤';
    if (type === 'like_post' || type === 'like_story') return '❤️';
    if (type === 'comment') return '💬';
    return '🔔';
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex">
      <Navigation />
      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-0 pb-[100px] md:pb-10">
        <div className="p-5 border-b border-[rgba(0,255,136,0.2)] sticky top-0 bg-[#01080b] z-[100]">
          <h2 className="m-0 text-xl">Notifications 🔔</h2>
        </div>

        <div className="p-[10px]">
          {fetching && <div className="text-center py-12 text-[#555]">Loading notifications...</div>}
          {!fetching && notifications.length === 0 && (
            <div className="text-center py-12 text-[#555]">No notifications yet</div>
          )}
          {notifications.map(n => {
            const time = n.createdAt?.toDate?.().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) || '';
            return (
              <div
                key={n.id}
                onClick={() => markAsRead(n.id, n.fromUid)}
                className={`flex items-center gap-4 p-4 border-b border-[#111] transition-all cursor-pointer relative ${!n.isRead ? 'bg-[rgba(0,255,136,0.05)]' : ''}`}
              >
                {!n.isRead && (
                  <div className="absolute left-[5px] top-1/2 -translate-y-1/2 w-2 h-2 bg-[#00ff88] rounded-full" />
                )}
                <Image
                  src={n.fromPhoto || '/logo.png'}
                  alt={n.fromName}
                  width={45} height={45}
                  className="rounded-full border border-[#00ff88] object-cover"
                />
                <div className="flex-1 text-sm">
                  <b className="text-[#00ff88]">{n.fromName}</b> {getMsg(n.type)}
                  <div className="text-[11px] text-[#555] mt-1">{getIcon(n.type)} {time}</div>
                </div>
                {n.storyImg && (
                  <Image src={n.storyImg} alt="story" width={45} height={45} className="rounded-[8px] object-cover" />
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
