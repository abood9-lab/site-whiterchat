'use client';
import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  doc, onSnapshot, collection, query, orderBy, addDoc,
  serverTimestamp, updateDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Image from 'next/image';

interface Message {
  id: string;
  senderId: string;
  text?: string;
  gif?: string;
  type?: string;
  replyTo?: string | null;
  replyText?: string;
  createdAt?: { toDate: () => Date } | null;
  edited?: boolean;
}

interface FriendData {
  username?: string;
  photoURL?: string;
  status?: string;
}

function ChatContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const friendId = searchParams.get('id') || '';
  const [friendData, setFriendData] = useState<FriendData>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatId, setChatId] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
  const [mediaPanel, setMediaPanel] = useState(false);
  const [mediaTab, setMediaTab] = useState<'gifs' | 'stickers'>('gifs');
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaResults, setMediaResults] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: Message } | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToastMsg(text);
    setTimeout(() => setToastMsg(''), 2500);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !friendId) return;
    const cId = user.uid < friendId ? `${user.uid}_${friendId}` : `${friendId}_${user.uid}`;
    setChatId(cId);

    onSnapshot(doc(db, 'users', friendId), snap => {
      if (snap.exists()) setFriendData(snap.data() as FriendData);
    });

    const q = query(collection(db, 'chats', cId, 'messages'), orderBy('createdAt', 'asc'));
    onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Message, 'id'>) })));
      setTimeout(() => scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }), 100);
    });

    // typing indicator
    onSnapshot(doc(db, 'chats', cId, 'typing', friendId), snap => {
      setIsTyping(!!snap.data()?.isTyping);
    });
  }, [user, friendId]);

  const handleInput = async (val: string) => {
    setInput(val);
    if (!chatId || !user) return;
    await updateDoc(doc(db, 'chats', chatId, 'typing', user.uid), { isTyping: true }).catch(() => {});
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(async () => {
      await updateDoc(doc(db, 'chats', chatId, 'typing', user.uid), { isTyping: false }).catch(() => {});
    }, 2000);
  };

  const sendMsg = async (overrideText?: string, gif?: string) => {
    if (!user || !chatId) return;
    const text = overrideText || input.trim();
    if (!text && !gif) return;
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      senderId: user.uid, text: gif ? undefined : text, gif,
      type: gif ? 'gif' : 'text',
      replyTo: replyTo?.id || null, replyText: replyTo?.text || null,
      createdAt: serverTimestamp(),
    });
    setInput('');
    setReplyTo(null);
    setMediaPanel(false);
  };

  const deleteMsg = async (id: string) => {
    if (!chatId) return;
    await deleteDoc(doc(db, 'chats', chatId, 'messages', id));
    setContextMenu(null);
  };

  const editMsg = async (id: string) => {
    const newText = window.prompt('Edit message:', contextMenu?.msg.text || '');
    if (newText && chatId) {
      await updateDoc(doc(db, 'chats', chatId, 'messages', id), { text: newText, edited: true });
    }
    setContextMenu(null);
  };

  const fetchMedia = useCallback(async (search: string, tab: 'gifs' | 'stickers') => {
    const term = search || (tab === 'gifs' ? 'funny' : 'cute');
    try {
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(term)}&limit=9`);
      const data = await res.json();
      setMediaResults((data.data || []).map((g: { images: { fixed_height: { url: string } } }) => g.images.fixed_height.url));
    } catch { setMediaResults([]); }
  }, []);

  useEffect(() => {
    if (mediaPanel) fetchMedia(mediaSearch, mediaTab);
  }, [mediaPanel, mediaTab, mediaSearch, fetchMedia]);

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="bg-[#01080b] text-white h-screen flex flex-col overflow-hidden fixed w-full">
      {/* Toast */}
      <div className="fixed top-[-60px] left-1/2 -translate-x-1/2 bg-[#00ff88] text-black px-6 py-[10px] rounded-[50px] font-bold z-[9999] transition-all shadow-[0_4px_15px_rgba(0,255,136,0.4)]"
        style={{ top: toastMsg ? '20px' : '-60px' }}>
        {toastMsg}
      </div>

      {/* Header */}
      <header className="p-4 bg-[rgba(10,25,30,0.96)] border-b border-[rgba(0,255,136,0.2)] flex items-center gap-3 z-[1000]">
        <button onClick={() => router.back()} className="bg-none border-none text-[#00ff88] cursor-pointer text-xl mr-1">←</button>
        <Image src={friendData.photoURL || '/logo.png'} alt={friendData.username || 'User'} width={45} height={45} className="rounded-full border-2 border-[#00ff88] object-cover" />
        <div className="flex-1">
          <b>{friendData.username || 'Loading...'}</b><br />
          <span className="text-[12px] text-[#00ff88]">{friendData.status || 'Online'}</span>
          {isTyping && <div className="flex items-center gap-[3px] mt-[5px]"><span className="w-[5px] h-[5px] bg-[#00ff88] rounded-full animate-bounce" style={{ animationDelay: '0s' }} /><span className="w-[5px] h-[5px] bg-[#00ff88] rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} /><span className="w-[5px] h-[5px] bg-[#00ff88] rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} /></div>}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 pb-[120px]">
        {messages.map(msg => {
          const isMine = msg.senderId === user.uid;
          return (
            <div key={msg.id} className={`max-w-[80%] flex flex-col ${isMine ? 'self-end' : 'self-start'}`}
              onClick={e => setContextMenu({ x: e.clientX, y: e.clientY, msg })}
            >
              {msg.replyText && (
                <div className="bg-[rgba(0,255,136,0.1)] p-2 rounded-[10px] mb-2 border-l-[3px] border-[#00ff88]">
                  <span className="text-[11px] text-[#00ff88] overflow-hidden whitespace-nowrap text-ellipsis block pr-[25px]">{msg.replyText}</span>
                </div>
              )}
              <div className={`p-3 rounded-[18px] text-[15px] relative cursor-pointer transition-all ${isMine ? 'text-black rounded-br-[4px]' : 'text-white border border-[rgba(0,255,136,0.2)] rounded-bl-[4px] bg-[#1a2429]'}`}
                style={isMine ? { background: 'linear-gradient(135deg, #00ff88, #00a86b)' } : {}}
              >
                {msg.gif ? <Image src={msg.gif} alt="gif" width={200} height={100} className="max-w-[200px] rounded-[8px]" /> : <span>{msg.text}{msg.edited && <span className="text-[10px] opacity-60 ml-1">(edited)</span>}</span>}
              </div>
              {isMine && <span className="text-[10px] text-[#00ff88] mt-1 self-end">✓✓</span>}
            </div>
          );
        })}
      </div>

      {/* Media Panel */}
      {mediaPanel && (
        <div className="fixed bottom-[85px] left-[10px] right-[10px] h-[350px] bg-[rgba(10,25,30,0.96)] border-2 border-[#00ff88] rounded-[25px] flex flex-col z-[2000] overflow-hidden backdrop-blur-[20px]">
          <div className="flex border-b border-[rgba(0,255,136,0.2)]">
            {(['gifs', 'stickers'] as const).map(tab => (
              <button key={tab} onClick={() => setMediaTab(tab)}
                className={`flex-1 p-3 text-center cursor-pointer font-bold border-none ${mediaTab === tab ? 'bg-[#00ff88] text-black' : 'text-[#00ff88] bg-none'}`}
              >
                {tab === 'gifs' ? 'GIFs' : 'Stickers'}
              </button>
            ))}
            <button onClick={() => setMediaPanel(false)} className="p-[10px] text-white bg-none border-none cursor-pointer">✕</button>
          </div>
          <div className="p-[10px]">
            <input type="text" value={mediaSearch} onChange={e => { setMediaSearch(e.target.value); fetchMedia(e.target.value, mediaTab); }}
              placeholder="Search..." className="w-full p-[10px] rounded-[15px] border border-[#00ff88] bg-black text-white outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto grid grid-cols-3 gap-2 p-[10px]">
            {mediaResults.map((url, i) => (
              <Image key={i} src={url} alt="media" width={100} height={90} className="w-full h-[90px] object-contain cursor-pointer" onClick={() => sendMsg(undefined, url)} />
            ))}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed bg-[#0d171b] border border-[#00ff88] rounded-[15px] z-[5000] w-[180px] shadow-[0_0_20px_rgba(0,255,136,0.3)]"
          style={{ top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 200) }}
          onClick={() => setContextMenu(null)}
        >
          <div className="p-3 cursor-pointer border-b border-[#222] text-sm flex items-center gap-[10px] hover:bg-[#00ff88] hover:text-black"
            onClick={() => { setReplyTo({ id: contextMenu.msg.id, text: contextMenu.msg.text || '' }); setContextMenu(null); }}
          >↩ Reply</div>
          <div className="p-3 cursor-pointer border-b border-[#222] text-sm flex items-center gap-[10px] hover:bg-[#00ff88] hover:text-black"
            onClick={() => { navigator.clipboard.writeText(contextMenu.msg.text || ''); showToast('Copied!'); setContextMenu(null); }}
          >📋 Copy</div>
          {contextMenu.msg.senderId === user.uid && <>
            <div className="p-3 cursor-pointer border-b border-[#222] text-sm flex items-center gap-[10px] hover:bg-[#00ff88] hover:text-black"
              onClick={() => editMsg(contextMenu.msg.id)}
            >✏️ Edit</div>
            <div className="p-3 cursor-pointer text-sm flex items-center gap-[10px] text-[#ff4d4d] hover:bg-[#00ff88] hover:text-black"
              onClick={() => deleteMsg(contextMenu.msg.id)}
            >🗑️ Delete</div>
          </>}
        </div>
      )}
      {contextMenu && <div className="fixed inset-0 z-[4999]" onClick={() => setContextMenu(null)} />}

      {/* Footer */}
      <footer className="p-[10px] pb-[calc(15px+env(safe-area-inset-bottom))] bg-[rgba(10,25,30,0.96)] border-t border-[rgba(0,255,136,0.2)] fixed bottom-0 w-full z-[1001]">
        {replyTo && (
          <div className="hidden bg-[rgba(0,255,136,0.1)] p-2 rounded-[10px] mb-2 border-l-[3px] border-[#00ff88] relative" style={{ display: replyTo ? 'block' : 'none' }}>
            <span className="text-[11px] text-[#00ff88] overflow-hidden whitespace-nowrap text-ellipsis block pr-[25px]">{replyTo.text}</span>
            <button onClick={() => setReplyTo(null)} className="absolute right-[10px] top-2 bg-none border-none text-white cursor-pointer">✕</button>
          </div>
        )}
        <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.05)] rounded-[25px] px-3 py-[5px] border border-[rgba(255,255,255,0.1)]">
          <button onClick={() => setMediaPanel(p => !p)} className="text-[#00ff88] text-[22px] cursor-pointer bg-none border-none">➕</button>
          <button onClick={() => setMediaPanel(p => !p)} className="text-[#00ff88] text-[22px] cursor-pointer bg-none border-none">😊</button>
          <input
            type="text" value={input} onChange={e => handleInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMsg()}
            placeholder="Type a message..."
            className="flex-1 bg-none border-none text-white p-3 outline-none text-base"
            autoComplete="off"
          />
          {input.trim()
            ? <button onClick={() => sendMsg()} className="text-[#00ff88] text-[22px] cursor-pointer bg-none border-none">➤</button>
            : <button className="text-[#00ff88] text-[22px] cursor-pointer bg-none border-none">🎤</button>
          }
        </div>
      </footer>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>}>
      <ChatContent />
    </Suspense>
  );
}
