'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection, query, where, onSnapshot, doc, addDoc,
  deleteDoc, serverTimestamp, orderBy, getDocs,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';
import Link from 'next/link';

interface Note {
  id: string;
  uid: string;
  username: string;
  photoURL?: string;
  text: string;
  songTitle?: string;
  songArtist?: string;
  previewUrl?: string;
}

interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  updatedAt?: { toDate: () => Date } | null;
}

interface Group {
  id: string;
  name: string;
  members: string[];
  createdAt?: { toDate: () => Date } | null;
}

interface Friend {
  uid: string;
  username?: string;
  photoURL?: string;
}

export default function MessagesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [musicSearch, setMusicSearch] = useState('');
  const [musicResults, setMusicResults] = useState<{ trackName: string; artistName: string; artworkUrl60: string; previewUrl: string }[]>([]);
  const [chosenSong, setChosenSong] = useState<{ title: string; artist: string; previewUrl: string } | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [viewNote, setViewNote] = useState<Note | null>(null);
  const [noteReply, setNoteReply] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    loadNotes();
    loadChats();
    loadGroups();
    loadFriends();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadNotes = () => {
    if (!user) return;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    onSnapshot(collection(db, 'notes'), snap => {
      const n: Note[] = snap.docs
        .filter(d => d.data().createdAt?.toDate?.() > dayAgo)
        .map(d => ({ id: d.id, ...(d.data() as Omit<Note, 'id'>) }));
      setNotes(n);
    });
  };

  const loadChats = () => {
    if (!user) return;
    onSnapshot(query(collection(db, 'chats'), where('participants', 'array-contains', user.uid)), snap => {
      const c: Chat[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Chat, 'id'>) }));
      setChats(c);
    });
  };

  const loadGroups = () => {
    if (!user) return;
    onSnapshot(query(collection(db, 'groups'), where('members', 'array-contains', user.uid)), snap => {
      setGroups(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) })));
    });
  };

  const loadFriends = async () => {
    if (!user) return;
    const { getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', user.uid));
    const following: string[] = snap.data()?.following || [];
    const list: Friend[] = [];
    for (const uid of following) {
      const uSnap = await getDoc(doc(db, 'users', uid));
      if (uSnap.exists()) list.push({ uid, ...(uSnap.data() as Omit<Friend, 'uid'>) });
    }
    setFriends(list);
  };

  const searchMusic = async (val: string) => {
    setMusicSearch(val);
    if (val.length < 2) { setMusicResults([]); return; }
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(val)}&entity=song&limit=5`);
      const data = await res.json();
      setMusicResults(data.results || []);
    } catch { setMusicResults([]); }
  };

  const publishNote = async () => {
    if (!user || !noteText.trim()) return;
    await addDoc(collection(db, 'notes'), {
      uid: user.uid, username: user.displayName || 'User',
      photoURL: user.photoURL, text: noteText,
      songTitle: chosenSong?.title, songArtist: chosenSong?.artist,
      previewUrl: chosenSong?.previewUrl, createdAt: serverTimestamp(),
    });
    setNoteText(''); setChosenSong(null); setMusicSearch(''); setShowNoteModal(false);
  };

  const deleteNote = async (id: string) => {
    await deleteDoc(doc(db, 'notes', id));
  };

  const createGroup = async () => {
    if (!user || !groupName.trim() || selectedFriends.length === 0) return;
    await addDoc(collection(db, 'groups'), {
      name: groupName, members: [user.uid, ...selectedFriends], createdBy: user.uid, createdAt: serverTimestamp(),
    });
    setGroupName(''); setSelectedFriends([]); setShowGroupModal(false);
  };

  const sendNoteReply = async () => {
    if (!user || !viewNote || !noteReply.trim()) return;
    await addDoc(collection(db, 'chats'), {
      sender: user.uid, receiver: viewNote.uid,
      participants: [user.uid, viewNote.uid],
      text: `Reply to note: ${noteReply}`,
      type: 'text', createdAt: serverTimestamp(),
    });
    setNoteReply(''); setViewNote(null);
  };

  const myNote = notes.find(n => n.uid === user?.uid);

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex">
      <Navigation />
      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-10 px-4 pb-[100px] md:pb-10 flex flex-col items-center">
        <div className="w-full max-w-[600px]">
          {/* Notes */}
          <div className="flex gap-4 overflow-x-auto pb-5" style={{ scrollbarWidth: 'none' }}>
            <div className="relative min-w-[85px] text-center cursor-pointer" onClick={() => setShowNoteModal(true)}>
              <div className="absolute top-[-15px] left-[-5px] bg-[#00ff88] text-black px-3 py-[5px] rounded-[18px] text-[11px] max-w-[90px] overflow-hidden whitespace-nowrap font-bold z-10">
                {myNote ? myNote.text : '+ Note'}
              </div>
              <Image src={user.photoURL || '/logo.png'} alt="me" width={70} height={70} className="w-[70px] h-[70px] rounded-full border-[2.3px] border-[#00ff88] object-cover bg-[#111] p-[2px] mt-4" />
              <div className="text-[11px] mt-2 text-[#777] font-bold">Your Note</div>
              {myNote && <button onClick={e => { e.stopPropagation(); deleteNote(myNote.id); }} className="absolute top-[-10px] right-0 bg-[#ff4444] text-white border-none rounded-full w-[22px] h-[22px] text-xs z-20 cursor-pointer">✕</button>}
            </div>
            {notes.filter(n => n.uid !== user.uid).map(n => (
              <div key={n.id} className="relative min-w-[85px] text-center cursor-pointer" onClick={() => setViewNote(n)}>
                <div className="absolute top-[-15px] left-[-5px] bg-white text-black px-3 py-[5px] rounded-[18px] text-[11px] max-w-[90px] overflow-hidden whitespace-nowrap shadow-[0_4px_15px_rgba(0,0,0,0.5)] z-10">
                  {n.text}
                </div>
                {n.songTitle && <div className="absolute bottom-[25px] left-0 bg-[#1DB954] text-white w-[22px] h-[22px] rounded-full text-[10px] flex items-center justify-center border-2 border-[#01080b]">♪</div>}
                <Image src={n.photoURL || '/logo.png'} alt={n.username} width={70} height={70} className="w-[70px] h-[70px] rounded-full border-[2.3px] border-[#00ff88] object-cover bg-[#111] p-[2px] mt-4" />
                <div className="text-[11px] mt-2">{n.username}</div>
              </div>
            ))}
          </div>

          {/* Groups */}
          <div className="w-full text-white text-base my-6 mb-4 font-bold border-l-[3px] border-[#00ff88] pl-[10px] flex justify-between items-center">
            Groups
            <button onClick={() => setShowGroupModal(true)} className="bg-none border-none text-[#00ff88] cursor-pointer text-sm">➕ New</button>
          </div>
          <div className="flex flex-col gap-2 w-full">
            {groups.map(g => (
              <div key={g.id} className="flex items-center gap-4 p-3 bg-[rgba(255,255,255,0.03)] rounded-[18px] cursor-pointer" onClick={() => router.push(`/group-chat?id=${g.id}`)}>
                <div className="w-[55px] h-[55px] rounded-full bg-[#222] flex items-center justify-center border border-[#00ff88] text-2xl">👥</div>
                <div>
                  <b>{g.name}</b>
                  <div className="text-[11px] text-[#555]">{g.members.length} members</div>
                </div>
              </div>
            ))}
          </div>

          {/* Chats */}
          <div className="w-full text-white text-base my-6 mb-4 font-bold border-l-[3px] border-[#00ff88] pl-[10px]">Chats</div>
          <div className="flex flex-col gap-2 w-full">
            {chats.map(chat => {
              const otherUid = chat.participants.find(u => u !== user.uid) || '';
              return (
                <Link key={chat.id} href={`/chat?id=${otherUid}`} className="flex items-center gap-4 p-3 bg-[rgba(255,255,255,0.03)] rounded-[18px] cursor-pointer no-underline text-white">
                  <div className="relative w-[55px] h-[55px]">
                    <Image src="/logo.png" alt="user" width={55} height={55} className="w-full h-full rounded-full object-cover bg-[#111]" />
                  </div>
                  <div>
                    <b>User: {otherUid.substring(0, 8)}</b>
                    <div className="text-[11px] text-[#555]">{chat.lastMessage || 'No messages yet'}</div>
                  </div>
                </Link>
              );
            })}
            {chats.length === 0 && <p className="text-center text-[#555] py-10">No chats yet. Follow people to start chatting!</p>}
          </div>
        </div>
      </main>

      {/* Note Create Modal */}
      {showNoteModal && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.92)] backdrop-blur-[15px] flex justify-center items-center z-[4000] p-5">
          <div className="bg-[#0a0f12] border border-[rgba(0,255,136,0.2)] p-[25px] rounded-[30px] w-full max-w-[380px] text-center">
            <h4 className="mt-0">Create a Note 🎵</h4>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Share a thought..." maxLength={60} rows={3}
              className="w-full bg-black border border-[rgba(0,255,136,0.2)] p-[14px] rounded-[15px] text-white mt-[15px] text-sm outline-none resize-none"
            />
            <input type="text" value={musicSearch} onChange={e => searchMusic(e.target.value)} placeholder="🔍 Add a song..."
              className="w-full bg-black border border-[rgba(0,255,136,0.2)] p-[14px] rounded-[15px] text-white mt-[15px] text-sm outline-none"
            />
            {musicResults.length > 0 && (
              <div className="max-h-[180px] overflow-y-auto bg-black rounded-[10px] mt-[10px] border border-[rgba(29,185,84,0.2)] text-left">
                {musicResults.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 p-[10px] border-b border-[#111] cursor-pointer" onClick={() => { setChosenSong({ title: t.trackName, artist: t.artistName, previewUrl: t.previewUrl }); setMusicResults([]); }}>
                    <Image src={t.artworkUrl60} alt={t.trackName} width={40} height={40} />
                    <div><b>{t.trackName}</b><br /><small>{t.artistName}</small></div>
                  </div>
                ))}
              </div>
            )}
            {chosenSong && <div className="text-[11px] text-[#00ff88] mt-[10px] font-bold">🎵 Added: {chosenSong.title}</div>}
            <button onClick={publishNote} className="w-full p-[14px] rounded-[15px] bg-[#00ff88] border-none font-bold mt-5 cursor-pointer text-black">Share</button>
            <button onClick={() => setShowNoteModal(false)} className="bg-none border-none text-gray-500 mt-[15px] cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {/* View Note Modal */}
      {viewNote && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.92)] backdrop-blur-[15px] flex justify-center items-center z-[4000] p-5">
          <div className="bg-[#0a0f12] border border-[rgba(0,255,136,0.2)] p-[25px] rounded-[30px] w-full max-w-[380px] text-center">
            <Image src={viewNote.photoURL || '/logo.png'} alt={viewNote.username} width={80} height={80} className="w-[80px] h-[80px] rounded-full border-[3px] border-[#00ff88] object-cover mx-auto" />
            <h4 className="my-4">{viewNote.username}</h4>
            <p className="bg-[rgba(255,255,255,0.05)] p-4 rounded-[15px] text-[#ccc] min-h-[50px]">{viewNote.text}</p>
            {viewNote.songTitle && <div className="text-[#1DB954] text-xs mb-4">♪ {viewNote.songTitle}</div>}
            <input type="text" value={noteReply} onChange={e => setNoteReply(e.target.value)} placeholder="Send a reply..."
              className="w-full bg-black border border-[rgba(0,255,136,0.2)] p-[14px] rounded-[15px] text-white mt-[15px] text-sm outline-none"
            />
            <button onClick={sendNoteReply} className="w-full p-[14px] rounded-[15px] bg-[#00ff88] border-none font-bold mt-5 cursor-pointer text-black">Send Reply</button>
            <button onClick={() => setViewNote(null)} className="bg-none border-none text-gray-500 mt-[15px] cursor-pointer">Close</button>
          </div>
        </div>
      )}

      {/* Group Create Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.92)] backdrop-blur-[15px] flex justify-center items-center z-[4000] p-5">
          <div className="bg-[#0a0f12] border border-[rgba(0,255,136,0.2)] p-[25px] rounded-[30px] w-full max-w-[380px] text-center">
            <h4>New Group 👥</h4>
            <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name..."
              className="w-full bg-black border border-[rgba(0,255,136,0.2)] p-[14px] rounded-[15px] text-white mt-[15px] text-sm outline-none"
            />
            <div className="max-h-[200px] overflow-y-auto mt-4">
              {friends.map(f => (
                <div key={f.uid} className={`flex justify-between items-center p-3 bg-[rgba(255,255,255,0.02)] mb-2 rounded-[15px] cursor-pointer ${selectedFriends.includes(f.uid) ? 'border border-[#00ff88] bg-[rgba(0,255,136,0.1)]' : ''}`}
                  onClick={() => setSelectedFriends(prev => prev.includes(f.uid) ? prev.filter(x => x !== f.uid) : [...prev, f.uid])}
                >
                  <div className="flex items-center gap-3">
                    <Image src={f.photoURL || '/logo.png'} alt={f.username || ''} width={40} height={40} className="rounded-full border border-[#00ff88]" />
                    <span>{f.username}</span>
                  </div>
                  {selectedFriends.includes(f.uid) && <span className="text-[#00ff88]">✓</span>}
                </div>
              ))}
            </div>
            <button onClick={createGroup} className="w-full p-[14px] rounded-[15px] bg-[#00ff88] border-none font-bold mt-4 cursor-pointer text-black">Create</button>
            <button onClick={() => setShowGroupModal(false)} className="bg-none border-none text-gray-500 mt-[10px] cursor-pointer">Cancel</button>
          </div>
        </div>
      )}
      <audio ref={audioRef} preload="auto" />
    </div>
  );
}
