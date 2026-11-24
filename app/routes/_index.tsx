import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { executionModeStore } from '~/lib/stores/executionMode';
import { modelSelectionStore } from '~/lib/stores/model';
import { ModelSelector } from '~/components/chat/ModelSelector.client';
import { PromptModeToggle } from '~/components/chat/PromptModeToggle.client';
import { PromptPlusMenu, VoiceMicButton } from '~/components/chat/PromptPlusMenu.client';
import { SendButton } from '~/components/chat/SendButton.client';
import { AuthModal } from '~/components/auth/AuthModal.client';
import { auth, onAuthStateChanged } from '~/lib/firebase';
import { classNames } from '~/utils/classNames';

function RevealSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={classNames(
        'transition-all duration-700 ease-out transform',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const selection = useStore(modelSelectionStore);
  const executionMode = useStore(executionModeStore);
  const [prompt, setPrompt] = useState('');
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const consumePendingPromptRedirect = () => {
    const pending = sessionStorage.getItem('pending_prompt');
    if (pending) {
      try {
        const { prompt: p, provider, model, mode } = JSON.parse(pending);
        sessionStorage.removeItem('pending_prompt');
        const resolvedMode = mode === 'plan' ? 'plan' : 'build';
        navigate(
          `/chat/new?prompt=${encodeURIComponent(p)}&provider=${provider}&model=${encodeURIComponent(model)}&mode=${resolvedMode}`,
          { replace: true },
        );
        return true;
      } catch {
        // fallback
      }
    }
    return false;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser: any) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        if (!consumePendingPromptRedirect()) {
          navigate('/chat/new', { replace: true });
        }
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handlePromptSubmit = (e?: React.FormEvent | React.UIEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const text = (overridePrompt ?? prompt).trim();
    if (!text) return;

    if (!user) {
      sessionStorage.setItem(
        'pending_prompt',
        JSON.stringify({
          prompt: text,
          provider: selection.provider,
          model: selection.model,
          mode: executionMode,
        }),
      );
      setIsAuthModalOpen(true);
      return;
    }

    navigate(
      `/chat/new?prompt=${encodeURIComponent(text)}&provider=${selection.provider}&model=${encodeURIComponent(selection.model)}&mode=${executionMode}`,
    );
  };

  const handleAuthSuccess = () => {
    setIsAuthModalOpen(false);
    if (!consumePendingPromptRedirect()) {
      navigate('/chat/new');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bolt-elements-background-depth-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-bolt-elements-button-primary-background border-t-transparent animate-spin"></div>
      </div>
    );
  }

  if (user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary font-sans selection:bg-bolt-elements-item-backgroundAccent selection:text-bolt-elements-textPrimary">
      {/* Top Header */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 flex items-center justify-between gap-8 px-6 lg:px-12 py-4 ${
          scrolled
            ? 'bg-bolt-elements-background-depth-1/90 backdrop-blur-md shadow-sm border-b border-bolt-elements-borderColor'
            : 'bg-transparent'
        }`}
      >
        <a
          href="/"
          className="text-2xl font-semibold text-bolt-elements-textPrimary flex items-center whitespace-nowrap shrink-0"
        >
          <span className="i-bolt:logo-text?mask w-[46px] inline-block" />
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-bolt-elements-textSecondary">
          <a href="#features" className="hover:text-bolt-elements-textPrimary transition-colors whitespace-nowrap shrink-0">
            Features
          </a>
          <a href="#showcase" className="hover:text-bolt-elements-textPrimary transition-colors whitespace-nowrap shrink-0">
            Cloud Sync
          </a>
          <a href="#providers" className="hover:text-bolt-elements-textPrimary transition-colors whitespace-nowrap shrink-0">
            AI Models
          </a>
        </nav>

        <div className="flex items-center gap-4 shrink-0">
          <a
            href="/auth?mode=signin"
            className="px-4 py-2 text-xs font-semibold text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary whitespace-nowrap shrink-0"
          >
            Sign In
          </a>
          <a
            href="/auth?mode=signup"
            className="px-4 py-2 text-xs font-semibold text-bolt-elements-button-primary-text bg-bolt-elements-button-primary-background hover:bg-bolt-elements-button-primary-backgroundHover rounded-lg shadow-sm transition-all whitespace-nowrap shrink-0"
          >
            Get Started
          </a>
        </div>
      </header>

      {/* Hero Section with Exact Bolt Prompt Box */}
      <section className="pt-[22vh] pb-24 px-6">
        <div className="max-w-chat mx-auto text-center">
          <h1 className="text-5xl text-center font-bold text-bolt-elements-textPrimary mb-2">
            Where ideas begin
          </h1>
          <p className="mb-8 text-center text-bolt-elements-textSecondary">
            Bring ideas to life in seconds or get help on existing projects.
          </p>

          {/* Exact Prompt Box matching reference layout */}
          <div className="relative w-full max-w-chat mx-auto z-prompt text-left">
            <form
              onSubmit={(e) => handlePromptSubmit(e)}
              className={classNames(
                'shadow-sm border border-bolt-elements-borderColor focus-within:border-bolt-elements-borderColorActive/50 bg-bolt-elements-prompt-background backdrop-filter backdrop-blur-[8px] rounded-2xl overflow-visible relative transition-theme',
              )}
            >
              <textarea
                ref={textareaRef}
                className="w-full px-4 pt-3.5 pb-1.5 rounded-t-2xl focus:outline-none resize-none text-sm sm:text-[15px] text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    if (event.shiftKey) {
                      return;
                    }
                    event.preventDefault();
                    handlePromptSubmit(event);
                  }
                }}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                style={{
                  minHeight: '76px',
                  maxHeight: '200px',
                }}
                placeholder={executionMode === 'plan' ? 'Message Bolt · Plan mode' : 'Message Bolt'}
                translate="no"
              />

              <div className="flex justify-between items-center gap-2 px-3 pb-2.5 pt-1">
                <div className="flex items-center gap-1 min-w-0">
                  <ClientOnly>
                    {() => (
                      <PromptPlusMenu
                        canUpload={true}
                        canEnhance={false}
                        hasInput={prompt.trim().length > 0}
                        onTriggerUpload={() => setIsAuthModalOpen(true)}
                      />
                    )}
                  </ClientOnly>
                  <ClientOnly>{() => <PromptModeToggle variant="minimal" />}</ClientOnly>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <ClientOnly>{() => <ModelSelector variant="icon" />}</ClientOnly>
                  <ClientOnly>
                    {() => (
                      <VoiceMicButton
                        onTranscript={(text) => {
                          setPrompt((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
                        }}
                      />
                    )}
                  </ClientOnly>
                  <ClientOnly>
                    {() => (
                      <SendButton
                        show={prompt.trim().length > 0}
                        isStreaming={false}
                        onClick={(event) => {
                          handlePromptSubmit(event);
                        }}
                      />
                    )}
                  </ClientOnly>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* Scroll-Reveal Feature Showcases */}
      <section
        id="features"
        className="py-24 px-6 lg:px-12 bg-bolt-elements-background-depth-2/50 border-t border-bolt-elements-borderColor"
      >
        <div className="max-w-7xl mx-auto space-y-28">
          {/* Feature 1 */}
          <RevealSection className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-6 space-y-6">
              <span className="text-xs font-bold uppercase tracking-wider text-bolt-elements-item-contentAccent">
                01. Advanced AI Synthesis
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-bolt-elements-textPrimary">
                Full-Stack Architecture Generated in Seconds
              </h2>
              <p className="text-bolt-elements-textSecondary text-base leading-relaxed">
                Leverage top-tier reasoning models to architect complete web applications, interactive components, and robust backend APIs with zero boilerplate delay.
              </p>
            </div>
            <div className="lg:col-span-6">
              <div className="rounded-2xl overflow-hidden shadow-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
                <img
                  src="/images/feature_ai_coding_1795334331777.jpg"
                  alt="AI Coding Dashboard"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-auto object-cover hover:scale-105 transition-transform duration-500"
                />
              </div>
            </div>
          </RevealSection>

          {/* Feature 2 */}
          <RevealSection id-anchor="providers" className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div id="providers" className="lg:col-span-6 lg:order-2 space-y-6">
              <span className="text-xs font-bold uppercase tracking-wider text-bolt-elements-item-contentAccent">
                02. Multi-Provider Flexibility
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-bolt-elements-textPrimary">
                Switch Between OpenRouter, Groq & Gemini Instantly
              </h2>
              <p className="text-bolt-elements-textSecondary text-base leading-relaxed">
                Never get locked into a single provider. Access 440+ active models with live catalog discovery, context length filtering, and pricing transparency.
              </p>
            </div>
            <div className="lg:col-span-6 lg:order-1">
              <div className="rounded-2xl overflow-hidden shadow-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
                <img
                  src="/images/feature_multi_provider_1795334330835.jpg"
                  alt="Model Selector Interface"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-auto object-cover hover:scale-105 transition-transform duration-500"
                />
              </div>
            </div>
          </RevealSection>

          {/* Feature 3 */}
          <RevealSection className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div id="showcase" className="lg:col-span-6 space-y-6">
              <span className="text-xs font-bold uppercase tracking-wider text-bolt-elements-item-contentAccent">
                03. Cloud & Database Persistence
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-bolt-elements-textPrimary">
                Firebase Firestore &amp; Daytona Volume Persistence
              </h2>
              <p className="text-bolt-elements-textSecondary text-base leading-relaxed">
                Your conversations, project metadata, and security rules are managed in Firebase. Every generated source file, build asset, and upload lives directly inside isolated Daytona Volumes.
              </p>
            </div>
            <div className="lg:col-span-6">
              <div className="rounded-2xl overflow-hidden shadow-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
                <img
                  src="/images/feature_cloud_sync_1795334331319.jpg"
                  alt="Daytona Volume and Firebase Sync"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-auto object-cover hover:scale-105 transition-transform duration-500"
                />
              </div>
            </div>
          </RevealSection>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 lg:px-12 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="i-bolt:logo-text?mask w-[46px] inline-block text-bolt-elements-textPrimary" />
            <span className="text-sm font-bold text-bolt-elements-textPrimary">AI Agent Platform</span>
          </div>
          <p className="text-xs text-bolt-elements-textTertiary">
            © {new Date().getFullYear()} Bolt. Powered by OpenRouter, Groq, Gemini, Firebase &amp; Daytona Volumes.
          </p>
        </div>
      </footer>

      {/* Auth Modal Guard */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
