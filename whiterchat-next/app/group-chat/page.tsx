'use client';
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';

interface GroupData {
  id: string;
  name: string;
  members: string[];
}

interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt?: { toDate: () => Date } | null;
}

function GroupChatContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get('id') || '';
  const [group, setGroup] = useState<GroupData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!groupId) return;
    getDoc(doc(db, 'groups', groupId)).then(snap => {
      if (snap.exists()) setGroup({ id: snap.id, ...(snap.data() as Omit<GroupData, 'id'>) });
    });
    onSnapshot(query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt', 'asc')), snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Message, 'id'>) })));
    });
  }, [groupId]);

  const sendMsg = async () => {
    if (!input.trim() || !user || !groupId) return;
    await addDoc(collection(db, 'groups', groupId, 'messages'), {
      senderId: user.uid, senderName: user.displayName || 'User', text: input, createdAt: serverTimestamp(),
    });
    setInput('');
  };

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="bg-[#01080b] text-white h-screen flex flex-col fixed w-full overflow-hidden">
      <header className="p-4 bg-[rgba(10,25,30,0.96)] border-b border-[rgba(0,255,136,0.2)] flex items-center gap-3">
        <button onClick={() => router.back()} className="bg-none border-none text-[#00ff88] cursor-pointer text-xl">←</button>
        <div className="w-10 h-10 rounded-full bg-[#222] flex items-center justify-center border border-[#00ff88] text-xl">👥</div>
        <div>
          <b>{group?.name || 'Group Chat'}</b>
          <div className="text-xs text-[#00ff88]">{group?.members.length || 0} members</div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 pb-[100px]">
        {messages.map(msg => {
          const isMine = msg.senderId === user?.uid;
          return (
            <div key={msg.id} className={`max-w-[80%] ${isMine ? 'self-end' : 'self-start'}`}>
              {!isMine && <div className="text-[11px] text-[#00ff88] mb-1">{msg.senderName}</div>}
              <div className={`p-3 rounded-[18px] text-sm ${isMine ? 'text-black rounded-br-[4px]' : 'bg-[#1a2429] text-white border border-[rgba(0,255,136,0.2)] rounded-bl-[4px]'}`}
                style={isMine ? { background: 'linear-gradient(135deg, #00ff88, #00a86b)' } : {}}>
                {msg.text}
              </div>
            </div>
          );
        })}
      </div>

      <footer className="p-[10px] pb-[calc(15px+env(safe-area-inset-bottom))] bg-[rgba(10,25,30,0.96)] border-t border-[rgba(0,255,136,0.2)] fixed bottom-0 w-full">
        <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.05)] rounded-[25px] px-3 py-[5px] border border-[rgba(255,255,255,0.1)]">
          <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMsg()}
            placeholder="Type a message..." className="flex-1 bg-none border-none text-white p-3 outline-none text-base"
          />
          <button onClick={sendMsg} className="text-[#00ff88] text-xl cursor-pointer bg-none border-none">➤</button>
        </div>
      </footer>
    </div>
  );
}

export default function GroupChatPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>}>
      <GroupChatContent />
    </Suspense>
  );
}
