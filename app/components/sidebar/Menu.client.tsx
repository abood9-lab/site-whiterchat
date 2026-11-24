import type { User } from 'firebase/auth';
import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import {
  auth,
  db as firestoreDb,
  doc,
  handleFirestoreError,
  onAuthStateChanged,
  onSnapshot,
  OperationType,
  signOut,
} from '~/lib/firebase';
import {
  db,
  deleteById,
  deriveDefaultUsername,
  ensureUserProfileOnAuth,
  getAll,
  chatId,
  type ChatHistoryItem,
  type UserProfile,
} from '~/lib/persistence';
import { notifyLogoutWorkspaceShutdown } from '~/lib/daytona/workspace.client';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { HistoryItem } from './HistoryItem';
import { UserProfileModal } from './UserProfileModal.client';
import { binDates } from './date-binning';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-150px',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent = { type: 'delete'; item: ChatHistoryItem } | null;

export function Menu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setAuthUser(currentUser);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = undefined;
      }

      if (!currentUser) {
        setUserProfile(null);
        return;
      }

      const path = `users/${currentUser.uid}`;
      const userRef = doc(firestoreDb, 'users', currentUser.uid);

      unsubscribeProfile = onSnapshot(
        userRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as Partial<UserProfile>;
            const resolvedName =
              data.displayName || currentUser.displayName || currentUser.email?.split('@')[0] || 'User';
            setUserProfile({
              uid: currentUser.uid,
              email: data.email || currentUser.email || '',
              displayName: resolvedName,
              username: data.username || deriveDefaultUsername(resolvedName, currentUser.email, currentUser.uid),
              bio: data.bio || '',
              photoURL: data.photoURL || currentUser.photoURL || '',
              createdAt: data.createdAt || '',
              updatedAt: data.updatedAt,
            });
          } else {
            void ensureUserProfileOnAuth(currentUser).then(setUserProfile).catch(logger.error);
          }
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, path);
        },
      );
    });

    return () => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
      unsubscribeAuth();
    };
  }, []);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  const deleteItem = useCallback((event: React.UIEvent, item: ChatHistoryItem) => {
    event.preventDefault();

    if (db) {
      deleteById(db, item.id)
        .then(() => {
          loadEntries();

          if (chatId.get() === item.id) {
            window.location.pathname = '/chat/new';
          }
        })
        .catch((error) => {
          toast.error('Failed to delete conversation');
          logger.error(error);
        });
    }
  }, []);

  const closeDialog = () => {
    setDialogContent(null);
  };

  useEffect(() => {
    if (open) {
      loadEntries();
    }
  }, [open, loadEntries]);

  useEffect(() => {
    const enterThreshold = 40;
    const exitThreshold = 40;

    function onMouseMove(event: MouseEvent) {
      if (profileOpen || dialogContent !== null) {
        return;
      }

      if (event.pageX < enterThreshold) {
        setOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [profileOpen, dialogContent]);

  return (
    <motion.div
      ref={menuRef}
      initial="closed"
      animate={open ? 'open' : 'closed'}
      variants={menuVariants}
      className="flex flex-col side-menu fixed top-0 w-[350px] h-full bg-bolt-elements-background-depth-2 border-r rounded-r-3xl border-bolt-elements-borderColor z-sidebar shadow-xl shadow-bolt-elements-sidebar-dropdownShadow text-sm"
    >
      <div className="flex items-center h-[var(--header-height)]">{/* Placeholder */}</div>
      <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
        <div className="p-4 space-y-2">
          <a
            href="/chat/new"
            className="flex gap-2 items-center bg-bolt-elements-sidebar-buttonBackgroundDefault text-bolt-elements-sidebar-buttonText hover:bg-bolt-elements-sidebar-buttonBackgroundHover rounded-md p-2 transition-theme"
          >
            <span className="inline-block i-bolt:chat scale-110" />
            Start new chat
          </a>
          {authUser?.email?.toLowerCase() === 'shahedalmefleh850@gmail.com' && authUser.emailVerified && (
            <a
              href="/admin/storage"
              className="flex gap-2 items-center bg-bolt-elements-background-depth-3/70 text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive border border-bolt-elements-borderColor rounded-md p-2 text-xs font-medium transition-theme"
            >
              <span className="inline-block i-ph:hard-drives text-base text-bolt-elements-item-contentAccent" />
              Storage &amp; Migration
            </a>
          )}
        </div>
        <div className="text-bolt-elements-textPrimary font-medium pl-6 pr-5 my-2">Your Chats</div>
        <div className="flex-1 overflow-scroll pl-4 pr-5 pb-5">
          {list.length === 0 && <div className="pl-2 text-bolt-elements-textTertiary">No previous conversations</div>}
          <DialogRoot open={dialogContent !== null}>
            {binDates(list).map(({ category, items }) => (
              <div key={category} className="mt-4 first:mt-0 space-y-1">
                <div className="text-bolt-elements-textTertiary sticky top-0 z-1 bg-bolt-elements-background-depth-2 pl-2 pt-2 pb-1">
                  {category}
                </div>
                {items.map((item) => (
                  <HistoryItem key={item.id} item={item} onDelete={() => setDialogContent({ type: 'delete', item })} />
                ))}
              </div>
            ))}
            <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
              {dialogContent?.type === 'delete' && (
                <>
                  <DialogTitle>Delete Chat?</DialogTitle>
                  <DialogDescription asChild>
                    <div>
                      <p>
                        You are about to delete <strong>{dialogContent.item.description}</strong>.
                      </p>
                      <p className="mt-1">Are you sure you want to delete this chat?</p>
                    </div>
                  </DialogDescription>
                  <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                    <DialogButton type="secondary" onClick={closeDialog}>
                      Cancel
                    </DialogButton>
                    <DialogButton
                      type="danger"
                      onClick={(event) => {
                        deleteItem(event, dialogContent.item);
                        closeDialog();
                      }}
                    >
                      Delete
                    </DialogButton>
                  </div>
                </>
              )}
            </Dialog>
          </DialogRoot>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-bolt-elements-borderColor p-3.5">
          {authUser ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                title="Open profile settings"
                className="flex items-center gap-2.5 min-w-0 flex-1 p-1.5 -ml-1.5 rounded-xl bg-transparent hover:bg-bolt-elements-item-backgroundActive transition-theme text-left cursor-pointer group"
              >
                <div className="w-9 h-9 rounded-full border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 overflow-hidden flex items-center justify-center shrink-0">
                  {userProfile?.photoURL || authUser.photoURL ? (
                    <img
                      src={userProfile?.photoURL || authUser.photoURL || ''}
                      alt={userProfile?.displayName || authUser.displayName || 'Profile'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-bold text-accent-500">
                      {(userProfile?.displayName || authUser.displayName || authUser.email || 'U')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-bolt-elements-textPrimary truncate flex items-center gap-1">
                    <span className="truncate">
                      {userProfile?.displayName || authUser.displayName || authUser.email?.split('@')[0] || 'User'}
                    </span>
                  </div>
                  <div className="text-[11px] text-bolt-elements-textSecondary truncate">
                    @{userProfile?.username || deriveDefaultUsername(authUser.displayName, authUser.email, authUser.uid)}
                  </div>
                </div>
                <span className="i-ph:pencil-simple text-sm text-bolt-elements-textTertiary group-hover:text-bolt-elements-item-contentAccent shrink-0 mr-1 transition-theme" />
              </button>

              <button
                type="button"
                title="Sign Out"
                onClick={async () => {
                  await notifyLogoutWorkspaceShutdown();
                  await signOut(auth);
                  window.location.href = '/';
                }}
                className="p-2 rounded-lg text-bolt-elements-textSecondary hover:text-bolt-elements-item-contentDanger hover:bg-bolt-elements-item-backgroundDanger transition-theme cursor-pointer shrink-0 bg-transparent"
              >
                <span className="i-ph:sign-out text-base block" />
              </button>
            </div>
          ) : (
            <a
              href="/auth?mode=signin"
              className="text-xs font-medium text-bolt-elements-item-contentAccent hover:underline"
            >
              Sign In
            </a>
          )}
          <ThemeSwitch className="ml-auto shrink-0" />
        </div>
      </div>

      <UserProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        authUser={authUser}
        profile={userProfile}
        onSaved={(updated) => setUserProfile(updated)}
      />
    </motion.div>
  );
}
