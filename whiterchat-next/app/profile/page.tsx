'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs,
  addDoc, serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import Image from 'next/image';
import { Suspense } from 'react';

const CLOUD_NAME = 'dt5pdj978';
const UPLOAD_PRESET = 'raneem';

interface UserData {
  uid?: string;
  username?: string;
  fullname?: string;
  note?: string;
  photoURL?: string;
  bannerURL?: string;
  followers?: string[];
  following?: string[];
  status?: string;
  avatarDecoration?: string;
}

interface PostItem {
  id: string;
  imageUrl?: string;
  images?: string[];
  videoUrl?: string;
}

function ProfileContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [isMyProfile, setIsMyProfile] = useState(false);
  const [userData, setUserData] = useState<UserData>({});
  const [postsCount, setPostsCount] = useState(0);
  const [gridItems, setGridItems] = useState<PostItem[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'reels'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [usersModalTitle, setUsersModalTitle] = useState('');
  const [usersList, setUsersList] = useState<UserData[]>([]);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [uploading, setUploading] = useState(false);
  const pfpInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    const uid = searchParams.get('uid') || user.uid;
    setProfileUid(uid);
    setIsMyProfile(uid === user.uid);
  }, [user, searchParams]);

  useEffect(() => {
    if (!profileUid) return;
    loadUserData();
    loadTab('posts');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUid]);

  const loadUserData = async () => {
    if (!profileUid) return;
    const snap = await getDoc(doc(db, 'users', profileUid));
    if (!snap.exists()) return;
    setUserData(snap.data() as UserData);
  };

  const loadTab = async (tab: 'posts' | 'reels') => {
    if (!profileUid) return;
    setActiveTab(tab);
    const collName = tab === 'posts' ? 'posts' : 'reels';
    const q = query(collection(db, collName), where('uid', '==', profileUid));
    const snap = await getDocs(q);
    const items: PostItem[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<PostItem, 'id'>) }));
    setGridItems(items);
    if (tab === 'posts') setPostsCount(items.length);
  };

  const handleUpload = async (file: File, field: string) => {
    if (!file || !user) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      await updateDoc(doc(db, 'users', user.uid), { [field]: data.secure_url });
      loadUserData();
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const toggleFollow = async () => {
    if (!user || !profileUid) return;
    const myId = user.uid;
    const isFollowing = (userData.followers || []).includes(myId);
    await updateDoc(doc(db, 'users', myId), { following: isFollowing ? arrayRemove(profileUid) : arrayUnion(profileUid) });
    await updateDoc(doc(db, 'users', profileUid), { followers: isFollowing ? arrayRemove(myId) : arrayUnion(myId) });
    if (!isFollowing) {
      await addDoc(collection(db, 'notifications'), {
        targetUid: profileUid, fromUid: myId, fromName: user.displayName || 'Someone',
        fromPhoto: user.photoURL || '/logo.png', type: 'follow', isRead: false, createdAt: serverTimestamp(),
      });
    }
    loadUserData();
  };

  const openUsersModal = async (type: 'followers' | 'following') => {
    const list = type === 'followers' ? (userData.followers || []) : (userData.following || []);
    setUsersModalTitle(type.toUpperCase());
    setShowUsersModal(true);
    const users: UserData[] = [];
    for (const uid of list) {
      const s = await getDoc(doc(db, 'users', uid));
      if (s.exists()) users.push(s.data() as UserData);
    }
    setUsersList(users);
  };

  const saveProfile = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { username: editName, note: editNote });
    await updateProfile(user, { displayName: editName });
    setShowEditModal(false);
    loadUserData();
  };

  const isFollowing = user ? (userData.followers || []).includes(user.uid) : false;

  if (loading) return <div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return null;

  const bioHtml = (userData.note || 'مرحباً بكم في بروفايلي').replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" class="text-[#00ff88] underline font-bold" onclick="event.stopPropagation()">$1</a>');

  return (
    <div className="bg-[#01080b] text-white min-h-screen flex">
      <Navigation />
      <main className="md:ml-[280px] w-full md:w-[calc(100%-280px)] pt-[70px] md:pt-0 px-5 pb-[100px] md:pb-10 overflow-x-hidden">
        <div className="max-w-[450px] mx-auto mt-5">
          {/* Profile Card */}
          <div className="bg-[rgba(10,15,18,0.8)] backdrop-blur-[25px] rounded-[35px] text-center border border-[rgba(0,255,136,0.3)] relative overflow-hidden pb-[30px]">
            {uploading && (
              <div className="absolute inset-0 bg-[rgba(0,0,0,0.85)] flex flex-col items-center justify-center z-[1000]">
                <div className="w-[30px] h-[30px] border-4 border-[rgba(255,255,255,0.1)] border-t-[#00ff88] rounded-full animate-spin" />
                <p className="text-[#00ff88] mt-[10px] font-bold">Uploading...</p>
              </div>
            )}

            {/* Banner */}
            <div className="absolute top-0 left-0 w-full h-[320px] z-0 overflow-hidden pointer-events-none">
              {userData.bannerURL ? (
                userData.bannerURL.includes('.mp4') || userData.bannerURL.includes('.mov')
                  ? <video src={userData.bannerURL} autoPlay muted loop playsInline className="w-full h-full object-cover opacity-60" />
                  : <Image src={userData.bannerURL} alt="banner" fill className="object-cover opacity-60" />
              ) : null}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 0%, #01080b 98%)' }} />
            </div>

            {isMyProfile && (
              <button onClick={() => bannerInputRef.current?.click()} className="absolute top-5 right-5 bg-[rgba(0,0,0,0.8)] text-white w-[45px] h-[45px] rounded-full flex items-center justify-center cursor-pointer z-[999] border-2 border-[#00ff88] shadow-[0_0_15px_#00ff88]">
                📷
              </button>
            )}

            <div className="relative z-10 pt-[45px]">
              {/* Avatar */}
              <div className="relative w-[140px] h-[140px] mx-auto mb-5">
                <Image src={userData.photoURL || '/logo.png'} alt="avatar" width={140} height={140} className="w-full h-full rounded-full border-4 border-[#00ff88] object-cover" />
                <div
                  className="absolute bottom-[10px] right-[10px] w-[28px] h-[28px] rounded-full border-4 border-[#0d1a17]"
                  style={{ background: userData.status === 'online' ? '#23a55a' : '#f23f43' }}
                />
                {isMyProfile && (
                  <button onClick={() => pfpInputRef.current?.click()} className="absolute bottom-0 left-0 bg-[#00ff88] text-black w-[40px] h-[40px] rounded-full flex items-center justify-center cursor-pointer z-[23] border-3 border-[#0d1a17]">
                    📷
                  </button>
                )}
              </div>

              <h2 className="m-0 text-[26px] font-bold">{userData.username || 'User'}</h2>
              <p className="text-[#666] mb-3">@{(userData.username || 'user').replace(/\s+/g, '').toLowerCase()}</p>
              <div className="text-[#eee] text-sm mx-[25px] leading-relaxed bg-[rgba(0,0,0,0.5)] p-[15px] rounded-[20px] relative z-[50]" dangerouslySetInnerHTML={{ __html: bioHtml }} />

              {/* Actions */}
              <div className="flex gap-[10px] justify-center flex-wrap my-5">
                {isMyProfile ? (
                  <button onClick={() => { setEditName(userData.username || ''); setEditNote(userData.note || ''); setShowEditModal(true); }}
                    className="bg-[#00ff88] text-black border-none px-7 py-3 rounded-[25px] font-bold cursor-pointer flex items-center gap-2 shadow-[0_4px_15px_rgba(0,255,136,0.2)]"
                  >
                    Edit Profile
                  </button>
                ) : (
                  <button onClick={toggleFollow}
                    className="border-none px-7 py-3 rounded-[25px] font-bold cursor-pointer"
                    style={{ background: isFollowing ? '#222' : '#00ff88', color: isFollowing ? 'white' : 'black' }}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
                <button onClick={() => router.push('/reels')} className="bg-transparent text-[#00ff88] border border-[#00ff88] px-7 py-3 rounded-[25px] font-bold cursor-pointer">
                  📹 Whiter VV
                </button>
              </div>

              {/* Stats */}
              <div className="flex justify-around mx-5 pt-5 border-t border-[rgba(255,255,255,0.1)]">
                <div className="text-center cursor-pointer">
                  <span className="block text-[#00ff88] text-2xl font-bold">{postsCount}</span>
                  <span className="text-[#555] text-[11px] font-bold">Posts</span>
                </div>
                <div className="text-center cursor-pointer" onClick={() => openUsersModal('followers')}>
                  <span className="block text-[#00ff88] text-2xl font-bold">{(userData.followers || []).length}</span>
                  <span className="text-[#555] text-[11px] font-bold">Followers</span>
                </div>
                <div className="text-center cursor-pointer" onClick={() => openUsersModal('following')}>
                  <span className="block text-[#00ff88] text-2xl font-bold">{(userData.following || []).length}</span>
                  <span className="text-[#555] text-[11px] font-bold">Following</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[#222] mt-8">
            {(['posts', 'reels'] as const).map(tab => (
              <button key={tab} onClick={() => loadTab(tab)}
                className={`flex-1 text-center py-4 cursor-pointer text-xl border-none bg-none ${activeTab === tab ? 'text-[#00ff88] border-b-[3px] border-b-[#00ff88]' : 'text-[#444]'}`}
              >
                {tab === 'posts' ? '⊞' : '▶'}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-3 gap-[5px] mt-[10px]">
            {gridItems.map(item => {
              const media = activeTab === 'posts' ? (item.imageUrl || item.images?.[0]) : item.videoUrl;
              return (
                <div key={item.id} className="aspect-square bg-[#0a0f12] rounded-[8px] overflow-hidden cursor-pointer" onClick={() => router.push(`/view-post?id=${item.id}`)}>
                  {media && (activeTab === 'posts'
                    ? <Image src={media} alt="post" width={200} height={200} className="w-full h-full object-cover" />
                    : <video src={media} className="w-full h-full object-cover" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <input type="file" ref={pfpInputRef} hidden accept="image/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'photoURL')} />
      <input type="file" ref={bannerInputRef} hidden accept="image/*,video/*" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], 'bannerURL')} />

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.95)] flex items-center justify-center z-[5000] backdrop-blur-[10px]">
          <div className="bg-[#0a0f12] p-[25px] rounded-[30px] w-[88%] max-w-[400px] border border-[rgba(0,255,136,0.3)]">
            <h3 className="text-[#00ff88] mt-0">Edit Profile</h3>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Display Name"
              className="w-full p-[14px] bg-black border border-[#222] text-white rounded-[15px] mt-[10px] outline-none"
            />
            <textarea value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Bio"
              className="w-full p-[14px] bg-black border border-[#222] text-white rounded-[15px] mt-[10px] outline-none resize-none"
              rows={3}
            />
            <button onClick={saveProfile} className="w-full bg-[#00ff88] text-black border-none p-3 rounded-[15px] font-bold cursor-pointer mt-2">Save Changes</button>
            <button onClick={() => setShowEditModal(false)} className="bg-none border-none text-[#555] w-full mt-[10px] cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {/* Users Modal */}
      {showUsersModal && (
        <div className="fixed inset-0 bg-[rgba(0,0,0,0.95)] flex items-center justify-center z-[5000] backdrop-blur-[10px]">
          <div className="bg-[#0a0f12] p-[25px] rounded-[30px] w-[88%] max-w-[400px] border border-[rgba(0,255,136,0.3)]">
            <h3 className="text-[#00ff88] mt-0">{usersModalTitle}</h3>
            <div className="max-h-[300px] overflow-y-auto my-4">
              {usersList.length === 0 ? <p className="text-center text-[#555]">Empty</p> : usersList.map((u, i) => (
                <div key={i} className="flex items-center gap-4 p-3 border-b border-[#111] cursor-pointer no-underline text-white" onClick={() => { router.push(`/profile?uid=${u.uid}`); setShowUsersModal(false); }}>
                  <Image src={u.photoURL || '/logo.png'} alt={u.username || ''} width={48} height={48} className="rounded-full border border-[#00ff88]" />
                  <b>{u.username}</b>
                </div>
              ))}
            </div>
            <button onClick={() => setShowUsersModal(false)} className="w-full bg-[#00ff88] text-black border-none p-3 rounded-[15px] font-bold cursor-pointer">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#01080b] flex items-center justify-center"><div className="w-8 h-8 border-4 border-[#00ff88] border-t-transparent rounded-full animate-spin" /></div>}>
      <ProfileContent />
    </Suspense>
  );
}
