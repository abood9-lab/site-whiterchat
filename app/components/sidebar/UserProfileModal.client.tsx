import * as RadixDialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import type { User } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { dialogBackdropVariants, dialogVariants } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { uploadFileToDaytonaWorkspace } from '~/lib/daytona/workspace.client';
import {
  deriveDefaultUsername,
  saveUserProfile,
  sanitizeUsername,
  USERNAME_REGEX,
  type UserProfile,
} from '~/lib/persistence/db';
import { classNames } from '~/utils/classNames';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  authUser: User | null;
  profile: UserProfile | null;
  onSaved?: (profile: UserProfile) => void;
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

export function UserProfileModal({ isOpen, onClose, authUser, profile, onSaved }: UserProfileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !authUser) {
      return;
    }

    const initialDisplayName =
      profile?.displayName || authUser.displayName || authUser.email?.split('@')[0] || 'User';
    const initialUsername =
      profile?.username || deriveDefaultUsername(initialDisplayName, authUser.email, authUser.uid);

    setDisplayName(initialDisplayName);
    setUsername(initialUsername);
    setBio(profile?.bio || '');
    setPhotoURL(profile?.photoURL || authUser.photoURL || '');
    setImgError(false);
    setShowUrlInput(false);
    setError(null);
  }, [isOpen, authUser, profile]);

  if (!authUser) {
    return null;
  }

  const handlePhotoSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, WEBP, GIF).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be 5 MB or smaller.');
      return;
    }

    setError(null);
    setUploadingPhoto(true);

    try {
      const result = await uploadFileToDaytonaWorkspace(file, {
        kind: 'profile',
        folder: 'avatars',
      });
      if (result.mediaUrl) {
        setPhotoURL(result.mediaUrl);
        setImgError(false);
        toast.success('Profile photo saved to Daytona Volume');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload profile photo.';
      setError(message);
      toast.error(message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedName = displayName.trim();
    const trimmedUsername = username.trim();

    if (!trimmedName) {
      setError('Full name cannot be empty.');
      return;
    }

    if (trimmedUsername && !USERNAME_REGEX.test(trimmedUsername)) {
      setError('Username can only contain English letters, numbers, dots (.), underscores (_), and hyphens (-).');
      return;
    }

    setSaving(true);

    try {
      const saved = await saveUserProfile(authUser.uid, {
        displayName: trimmedName,
        username: trimmedUsername,
        bio,
        photoURL,
      });

      onSaved?.(saved);
      toast.success('Profile updated successfully');
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save profile changes.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const initials = getInitials(displayName || authUser.displayName, authUser.email);
  const email = profile?.email || authUser.email || '';

  return (
    <RadixDialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay onClick={onClose} asChild>
          <motion.div
            className="bg-black/60 backdrop-blur-[2px] fixed inset-0 z-max"
            initial="closed"
            animate="open"
            exit="closed"
            variants={dialogBackdropVariants}
          />
        </RadixDialog.Overlay>
        <RadixDialog.Content asChild>
          <motion.div
            className="fixed top-[50%] left-[50%] z-max max-h-[92vh] w-[94vw] max-w-[820px] translate-x-[-50%] translate-y-[-50%] border border-bolt-elements-borderColor rounded-2xl bg-bolt-elements-background-depth-2 shadow-2xl focus:outline-none overflow-hidden flex flex-col"
            initial="closed"
            animate="open"
            exit="closed"
            variants={dialogVariants}
          >
            {/* Modal Header */}
            <div className="px-6 sm:px-8 py-4 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-between shrink-0">
              <RadixDialog.Title className="text-lg sm:text-xl font-semibold text-bolt-elements-textPrimary flex items-center gap-2.5">
                <span className="i-ph:user-circle text-2xl text-accent-500" />
                Account Profile
              </RadixDialog.Title>
              <RadixDialog.Close asChild onClick={onClose}>
                <IconButton icon="i-ph:x" title="Close" />
              </RadixDialog.Close>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              {/* Cover Banner inside scroll container so avatar overlap is never clipped */}
              <div className="h-24 sm:h-28 bg-gradient-to-r from-accent-600/25 via-accent-500/10 to-bolt-elements-background-depth-3 border-b border-bolt-elements-borderColor" />

              <div className="px-6 sm:px-8 pb-7">
                {/* Avatar overlapping banner cleanly */}
                <div className="relative z-10 -mt-14 mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex items-end gap-4">
                    <div className="relative group shrink-0">
                      <div className="w-28 h-28 rounded-full ring-4 ring-bolt-elements-background-depth-2 border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 overflow-hidden flex items-center justify-center shadow-lg">
                        {photoURL && !imgError ? (
                          <img
                            src={photoURL}
                            alt={displayName || 'Profile avatar'}
                            referrerPolicy="no-referrer"
                            onError={() => setImgError(true)}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-3xl font-bold text-accent-500 select-none">{initials}</span>
                        )}
                        {uploadingPhoto && (
                          <div className="absolute inset-0 bg-black/55 flex items-center justify-center rounded-full">
                            <span className="i-svg-spinners:90-ring-with-bg text-3xl text-white" />
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={uploadingPhoto}
                        onClick={() => fileInputRef.current?.click()}
                        title="Upload profile photo"
                        className="absolute bottom-1 right-1 w-9 h-9 rounded-full bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:text-accent-500 hover:border-bolt-elements-borderColorActive shadow-md flex items-center justify-center transition-theme cursor-pointer"
                      >
                        <span className="i-ph:camera text-base" />
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handlePhotoSelect}
                        className="hidden"
                      />
                    </div>

                    <div className="pb-1.5 min-w-0">
                      <div className="text-lg font-bold text-bolt-elements-textPrimary truncate max-w-[260px] sm:max-w-[340px]">
                        {displayName || 'User'}
                      </div>
                      <div className="text-sm text-bolt-elements-textSecondary truncate max-w-[260px] sm:max-w-[340px]">
                        @{username || 'username'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pb-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={uploadingPhoto}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover border border-bolt-elements-borderColor transition-theme cursor-pointer disabled:opacity-50"
                    >
                      <span className="i-ph:upload-simple text-base" />
                      Upload Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowUrlInput((prev) => !prev)}
                      title="Paste image URL"
                      className={classNames(
                        'inline-flex items-center justify-center p-2 rounded-lg text-sm border transition-theme cursor-pointer',
                        showUrlInput
                          ? 'bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text border-bolt-elements-borderColorActive'
                          : 'bg-bolt-elements-button-secondary-background text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary border-bolt-elements-borderColor',
                      )}
                    >
                      <span className="i-ph:link text-base" />
                    </button>
                    {photoURL && (
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoURL('');
                          setImgError(false);
                        }}
                        title="Remove photo"
                        className="inline-flex items-center justify-center p-2 rounded-lg text-sm bg-bolt-elements-button-danger-background text-bolt-elements-button-danger-text hover:bg-bolt-elements-button-danger-backgroundHover transition-theme cursor-pointer"
                      >
                        <span className="i-ph:trash text-base" />
                      </button>
                    )}
                  </div>
                </div>

                {showUrlInput && (
                  <div className="mb-5 p-4 rounded-xl bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor">
                    <label className="block text-xs font-medium text-bolt-elements-textSecondary mb-2">
                      Avatar Image URL
                    </label>
                    <input
                      type="url"
                      maxLength={1024}
                      value={photoURL}
                      onChange={(e) => {
                        setPhotoURL(e.target.value);
                        setImgError(false);
                      }}
                      placeholder="https://..."
                      className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme"
                    />
                  </div>
                )}

              {error && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-bolt-elements-button-danger-background border border-bolt-elements-button-danger-text/30 text-bolt-elements-button-danger-text text-sm flex items-start gap-2.5">
                  <span className="i-ph:warning-circle text-lg shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-5">
                {/* Full Name + Username */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="profile-display-name"
                      className="block text-xs font-medium text-bolt-elements-textSecondary mb-2"
                    >
                      Full Name
                    </label>
                    <div className="relative">
                      <span className="i-ph:user absolute left-3.5 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary text-base" />
                      <input
                        id="profile-display-name"
                        type="text"
                        required
                        maxLength={128}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Your full name"
                        className="w-full pl-9 pr-3.5 py-2.5 rounded-lg text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="profile-username"
                      className="block text-xs font-medium text-bolt-elements-textSecondary mb-2"
                    >
                      Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-bolt-elements-textTertiary text-sm font-medium">
                        @
                      </span>
                      <input
                        id="profile-username"
                        type="text"
                        required
                        maxLength={64}
                        value={username}
                        onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                        placeholder="username"
                        className="w-full pl-8 pr-3.5 py-2.5 rounded-lg text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme"
                      />
                    </div>
                  </div>
                </div>

                {/* Bio */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label
                      htmlFor="profile-bio"
                      className="block text-xs font-medium text-bolt-elements-textSecondary"
                    >
                      Bio
                    </label>
                    <span className="text-xs text-bolt-elements-textTertiary">{bio.length} / 500</span>
                  </div>
                  <textarea
                    id="profile-bio"
                    rows={5}
                    maxLength={500}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Write a short bio about yourself, your stack, or what you're building..."
                    className="w-full px-3.5 py-2.5 rounded-lg text-sm bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-bolt-elements-borderColorActive transition-theme resize-none"
                  />
                </div>

                {/* Email (Read-only) */}
                <div>
                  <label className="block text-xs font-medium text-bolt-elements-textSecondary mb-2">
                    Email Address
                  </label>
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-bolt-elements-background-depth-3/50 border border-bolt-elements-borderColor text-sm text-bolt-elements-textSecondary">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="i-ph:envelope-simple text-base text-bolt-elements-textTertiary shrink-0" />
                      <span className="truncate">{email || 'No email linked'}</span>
                    </div>
                    <span className="i-ph:lock-simple text-sm text-bolt-elements-textTertiary shrink-0 ml-2" />
                  </div>
                </div>
              </div>

                {/* Footer Actions */}
                <div className="mt-7 pt-5 border-t border-bolt-elements-borderColor flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="inline-flex h-[42px] items-center justify-center rounded-lg px-5 text-sm font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover transition-theme cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || uploadingPhoto}
                    className="inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover transition-theme cursor-pointer disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <span className="i-svg-spinners:90-ring-with-bg text-base" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <span className="i-ph:check-bold text-base" />
                        Save Profile
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
