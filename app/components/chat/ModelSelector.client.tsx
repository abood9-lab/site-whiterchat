import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  favoriteModelsStore,
  loadProviderCatalogs,
  makeModelKey,
  modelSelectionStore,
  providerCatalogsStore,
  recentModelsStore,
  setSelectedModel,
  toggleFavoriteModel,
} from '~/lib/stores/model';
import type { ModelCategory, ModelInfo, ProviderId } from '~/types/providers';
import { classNames } from '~/utils/classNames';
import { ProviderLogo } from './ProviderLogos';

type CategoryFilter = 'all' | ModelCategory;

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'coding', label: 'Coding' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'fast', label: 'Fast' },
];

function getProviderDisplayName(id: ProviderId, fallbackName: string): string {
  if (id === 'gemini') {
    return 'Google Gemini';
  }
  return fallbackName;
}

function formatContextLength(contextLength?: number): string | null {
  if (!contextLength || contextLength <= 0) {
    return null;
  }

  if (contextLength >= 1_000_000) {
    const m = contextLength / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`;
  }

  return `${Math.round(contextLength / 1000)}k ctx`;
}

interface ModelRowProps {
  model: ModelInfo;
  isSelected: boolean;
  isHighlighted: boolean;
  isFavorite: boolean;
  onSelect: (model: ModelInfo) => void;
  onToggleFavorite: (model: ModelInfo) => void;
  onHover: () => void;
}

function ModelRow({
  model,
  isSelected,
  isHighlighted,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onHover,
}: ModelRowProps) {
  const ctx = formatContextLength(model.contextLength);

  return (
    <div
      role="menuitemradio"
      aria-checked={isSelected}
      onMouseEnter={onHover}
      onClick={() => onSelect(model)}
      className={classNames(
        'group w-full flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-theme border',
        isSelected
          ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive/60'
          : isHighlighted
            ? 'bg-bolt-elements-item-backgroundActive border-bolt-elements-borderColor'
            : 'bg-transparent border-transparent hover:bg-bolt-elements-item-backgroundActive',
      )}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(model);
          }}
          title={isFavorite ? 'Remove from favorites' : 'Pin to favorites'}
          aria-label={isFavorite ? `Unpin ${model.name}` : `Pin ${model.name} to favorites`}
          className={classNames(
            'mt-0.5 p-1 rounded-md transition-theme shrink-0 cursor-pointer',
            isFavorite
              ? 'text-amber-400 bg-amber-500/10'
              : 'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
          )}
        >
          <span className={classNames('text-xs block', isFavorite ? 'i-ph:star-fill' : 'i-ph:star')} />
        </button>

        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span
            className={classNames(
              'text-xs font-medium truncate',
              isSelected ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textPrimary',
            )}
          >
            {model.name}
          </span>

          <span className="text-[10px] font-mono text-bolt-elements-textTertiary truncate">{model.id}</span>

          {model.description && (
            <p className="text-[11px] text-bolt-elements-textSecondary truncate">{model.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        <div className="flex flex-col items-end text-right font-mono tabular-nums">
          {model.pricingLabel && (
            <span
              className={classNames(
                'text-[10px] whitespace-nowrap font-medium',
                model.isFree ? 'text-bolt-elements-icon-success' : 'text-bolt-elements-textSecondary',
              )}
            >
              {model.pricingLabel}
            </span>
          )}
          {ctx && <span className="text-[10px] text-bolt-elements-textTertiary whitespace-nowrap">{ctx}</span>}
        </div>

        <div className="w-4 flex justify-end shrink-0">
          {isSelected && <span className="i-ph:check-circle-fill text-bolt-elements-item-contentAccent text-sm" />}
        </div>
      </div>
    </div>
  );
}

interface ProviderMenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

interface SubmenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

interface ModelSelectorProps {
  variant?: 'default' | 'icon';
}

export function ModelSelector({ variant = 'icon' }: ModelSelectorProps) {
  const selection = useStore(modelSelectionStore);
  const favorites = useStore(favoriteModelsStore);
  const recents = useStore(recentModelsStore);
  const { providers, loading, loaded } = useStore(providerCatalogsStore);

  const [isOpen, setIsOpen] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<ProviderId | null>(null);
  const [pinnedProvider, setPinnedProvider] = useState<ProviderId | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const activeInspectedProvider = hoveredProvider ?? pinnedProvider;

  const [menuPos, setMenuPos] = useState<ProviderMenuPosition>({
    left: 16,
    bottom: 80,
    width: 244,
  });

  const [submenuPos, setSubmenuPos] = useState<SubmenuPosition>({
    left: 268,
    top: 100,
    width: 340,
    maxHeight: 380,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const providerMenuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const providerRowRefs = useRef<Partial<Record<ProviderId, HTMLButtonElement | null>>>({});
  const hoverCloseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadProviderCatalogs();
  }, []);

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredProvider(null);
    }, 180);
  }, [clearHoverCloseTimer]);

  const updateProviderMenuPosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = Math.min(248, viewportW - 24);
    const spaceAbove = rect.top - 12;
    const spaceBelow = viewportH - rect.bottom - 12;
    const openUpward = spaceAbove >= 220 || spaceAbove >= spaceBelow;
    const left = Math.max(12, Math.min(rect.left, viewportW - width - 12));

    if (openUpward) {
      setMenuPos({
        left,
        bottom: viewportH - rect.top + 8,
        width,
      });
    } else {
      setMenuPos({
        left,
        top: rect.bottom + 8,
        width,
      });
    }
  }, []);

  const updateSubmenuPosition = useCallback((providerId: ProviderId) => {
    if (!providerMenuRef.current || typeof window === 'undefined') {
      return;
    }

    const menuRect = providerMenuRef.current.getBoundingClientRect();
    const rowRect = providerRowRefs.current[providerId]?.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const width = Math.min(350, viewportW - 24);
    const maxHeight = Math.max(240, Math.min(380, viewportH - 32));
    const gap = 6;

    // Open to the right if enough space; otherwise open to the left; on narrow viewports, align safely inside viewport
    let left = menuRect.right + gap;
    if (left + width > viewportW - 12) {
      const leftSide = menuRect.left - width - gap;
      left = leftSide >= 12 ? leftSide : Math.max(12, viewportW - width - 12);
    }

    const anchorTop = rowRect ? rowRect.top - 8 : menuRect.top;
    const top = Math.max(12, Math.min(anchorTop, viewportH - maxHeight - 12));

    setSubmenuPos({
      left,
      top,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleGlobalShortcut);
    return () => document.removeEventListener('keydown', handleGlobalShortcut);
  }, []);

  // Reset inspected provider ONLY when the dropdown opens or closes
  useEffect(() => {
    if (!isOpen) {
      clearHoverCloseTimer();
      setHoveredProvider(null);
      setPinnedProvider(null);
      return;
    }

    setHoveredProvider(null);
    setPinnedProvider(null);
    setCategoryFilter('all');
    setSearchQuery('');
    setHighlightedIndex(0);
    updateProviderMenuPosition();
  }, [isOpen, updateProviderMenuPosition, clearHoverCloseTimer]);

  // Attach outside-click, Escape, and resize listeners cleanly without resetting hover state
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        providerMenuRef.current &&
        !providerMenuRef.current.contains(target) &&
        (!submenuRef.current || !submenuRef.current.contains(target)) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (activeInspectedProvider) {
          setHoveredProvider(null);
          setPinnedProvider(null);
        } else {
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      }
    };

    const handleReposition = () => {
      updateProviderMenuPosition();
      if (activeInspectedProvider) {
        updateSubmenuPosition(activeInspectedProvider);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, activeInspectedProvider, updateProviderMenuPosition, updateSubmenuPosition]);

  useEffect(() => {
    if (isOpen && activeInspectedProvider) {
      updateSubmenuPosition(activeInspectedProvider);
    }
  }, [isOpen, activeInspectedProvider, updateSubmenuPosition]);

  useEffect(() => {
    return () => clearHoverCloseTimer();
  }, [clearHoverCloseTimer]);

  const activeProviderCatalog = useMemo(
    () => providers.find((p) => p.id === selection.provider) ?? providers[0],
    [providers, selection.provider],
  );

  const modelLookup = useMemo(() => {
    const map = new Map<string, ModelInfo>();
    for (const p of providers) {
      for (const m of p.models) {
        map.set(makeModelKey(p.id, m.id), m);
      }
    }
    return map;
  }, [providers]);

  const activeModelInfo = useMemo(
    () => modelLookup.get(makeModelKey(selection.provider, selection.model)),
    [modelLookup, selection.provider, selection.model],
  );

  const inspectedProviderCatalog = useMemo(
    () => (activeInspectedProvider ? providers.find((p) => p.id === activeInspectedProvider) ?? null : null),
    [providers, activeInspectedProvider],
  );

  const scopedModels = inspectedProviderCatalog?.models ?? [];

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilter, number> = {
      all: scopedModels.length,
      free: 0,
      coding: 0,
      reasoning: 0,
      fast: 0,
    };

    for (const model of scopedModels) {
      for (const cat of model.categories) {
        counts[cat] += 1;
      }
    }

    return counts;
  }, [scopedModels]);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return scopedModels.filter((model) => {
      if (categoryFilter !== 'all' && !model.categories.includes(categoryFilter)) {
        return false;
      }

      if (!q) {
        return true;
      }

      return (
        model.name.toLowerCase().includes(q) ||
        model.id.toLowerCase().includes(q) ||
        (model.description?.toLowerCase().includes(q) ?? false) ||
        model.capabilities.some((cap) => cap.toLowerCase().includes(q))
      );
    });
  }, [scopedModels, categoryFilter, searchQuery]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const favoriteModelsList = useMemo(() => {
    if (!activeInspectedProvider || searchQuery.trim() !== '' || categoryFilter !== 'all') {
      return [];
    }

    return favorites
      .map((key) => modelLookup.get(key))
      .filter((m): m is ModelInfo => Boolean(m))
      .filter((m) => m.provider === activeInspectedProvider);
  }, [favorites, modelLookup, activeInspectedProvider, searchQuery, categoryFilter]);

  const recentModelsList = useMemo(() => {
    if (!activeInspectedProvider || searchQuery.trim() !== '' || categoryFilter !== 'all') {
      return [];
    }

    return recents
      .map((item) => modelLookup.get(makeModelKey(item.provider, item.model)))
      .filter((m): m is ModelInfo => Boolean(m))
      .filter((m) => !favoriteSet.has(makeModelKey(m.provider, m.id)))
      .filter((m) => m.provider === activeInspectedProvider);
  }, [recents, modelLookup, favoriteSet, activeInspectedProvider, searchQuery, categoryFilter]);

  const flatSelectableModels = useMemo(
    () => [...favoriteModelsList, ...recentModelsList, ...filteredModels],
    [favoriteModelsList, recentModelsList, filteredModels],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [activeInspectedProvider, categoryFilter, searchQuery]);

  const handleActivateProviderHover = (providerId: ProviderId) => {
    clearHoverCloseTimer();
    if (hoveredProvider !== providerId) {
      setHoveredProvider(providerId);
      setSearchQuery('');
      setCategoryFilter('all');
    }
    updateSubmenuPosition(providerId);
  };

  const handlePinProvider = (providerId: ProviderId) => {
    clearHoverCloseTimer();
    setPinnedProvider(providerId);
    if (hoveredProvider !== providerId) {
      setHoveredProvider(providerId);
      setSearchQuery('');
      setCategoryFilter('all');
    }
    updateSubmenuPosition(providerId);
  };

  const handleSelectModel = (model: ModelInfo) => {
    setSelectedModel(model.provider, model.id);
    setHoveredProvider(null);
    setPinnedProvider(null);
    setIsOpen(false);
  };

  const handleSubmenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (flatSelectableModels.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % flatSelectableModels.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + flatSelectableModels.length) % flatSelectableModels.length);
    } else if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') {
      event.preventDefault();
      const target = flatSelectableModels[highlightedIndex];
      if (target) {
        handleSelectModel(target);
      }
    }
  };

  const displayModelName = activeModelInfo?.name || selection.model.split('/').pop() || selection.model;
  const displayProviderName = activeProviderCatalog
    ? getProviderDisplayName(activeProviderCatalog.id, activeProviderCatalog.name)
    : selection.provider;

  return (
    <>
      {variant === 'icon' ? (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          title={`Select provider · ${displayProviderName} (${displayModelName})`}
          aria-label={`Select provider (${displayProviderName})`}
          className={classNames(
            'relative w-8 h-8 rounded-lg flex items-center justify-center transition-theme cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
            isOpen
              ? 'bg-bolt-elements-item-backgroundActive text-bolt-elements-textPrimary'
              : 'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="6.75" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {activeProviderCatalog && !activeProviderCatalog.configured && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
          className={classNames(
            'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-theme whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-elements-borderColorActive',
            isOpen
              ? 'bg-bolt-elements-item-backgroundActive border-bolt-elements-borderColorActive text-bolt-elements-textPrimary'
              : 'bg-bolt-elements-background-depth-2 border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
          )}
          title={`Provider: ${displayProviderName} · Model: ${selection.model}`}
        >
          <ProviderLogo provider={selection.provider} className="w-3.5 h-3.5 shrink-0 text-bolt-elements-item-contentAccent" />
          <span className="font-semibold text-bolt-elements-textPrimary">{displayProviderName}</span>
          <span className="text-bolt-elements-textTertiary" aria-hidden="true">
            ·
          </span>
          <span className="max-w-[140px] sm:max-w-[200px] truncate text-bolt-elements-textSecondary font-medium">
            {displayModelName}
          </span>
          <span
            className={classNames(
              'i-ph:caret-down text-xs text-bolt-elements-textSecondary transition-transform duration-150 shrink-0',
              isOpen ? 'rotate-180' : undefined,
            )}
          />
        </button>
      )}

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Compact First-Level Provider Menu */}
            <div
              ref={providerMenuRef}
              role="menu"
              aria-label="Select Provider"
              onMouseEnter={clearHoverCloseTimer}
              onMouseLeave={scheduleHoverClose}
              style={{
                position: 'fixed',
                left: `${menuPos.left}px`,
                top: menuPos.top !== undefined ? `${menuPos.top}px` : undefined,
                bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
                width: `${menuPos.width}px`,
                zIndex: 1000,
                animation: 'fadeInMenu 140ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary shadow-2xl overflow-hidden"
            >
              <div className="px-3 py-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3/40 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-bolt-elements-textPrimary">Select provider</span>
                <button
                  type="button"
                  onClick={() => loadProviderCatalogs(true)}
                  disabled={loading}
                  title="Refresh live model catalogs"
                  className="p-1 rounded-md text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme disabled:opacity-50 cursor-pointer"
                >
                  <span className={classNames('i-ph:arrows-clockwise text-xs block', loading ? 'animate-spin' : undefined)} />
                </button>
              </div>

              <div className="p-1.5 space-y-1">
                {providers.map((provider) => {
                  const isHovered = activeInspectedProvider === provider.id;
                  const isSelectedProvider = selection.provider === provider.id;
                  const providerLabel = getProviderDisplayName(provider.id, provider.name);

                  return (
                    <button
                      key={provider.id}
                      ref={(el) => {
                        providerRowRefs.current[provider.id] = el;
                      }}
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={isHovered}
                      onMouseEnter={() => handleActivateProviderHover(provider.id)}
                      onFocus={() => handleActivateProviderHover(provider.id)}
                      onClick={() => handlePinProvider(provider.id)}
                      className={classNames(
                        'w-full flex items-center justify-between gap-2.5 px-2.5 py-2.5 rounded-lg text-left transition-theme cursor-pointer border',
                        isHovered
                          ? 'bg-bolt-elements-item-backgroundAccent border-bolt-elements-borderColorActive/50 text-bolt-elements-textPrimary'
                          : isSelectedProvider
                            ? 'bg-bolt-elements-item-backgroundActive/70 border-transparent text-bolt-elements-textPrimary'
                            : 'bg-transparent border-transparent text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor flex items-center justify-center shrink-0">
                          <ProviderLogo provider={provider.id} className="w-4 h-4 shrink-0" />
                        </div>
                        <div className="min-w-0 flex flex-col">
                          <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                            <span className="truncate">{providerLabel}</span>
                            {isSelectedProvider && (
                              <span className="i-ph:check-circle-fill text-xs text-bolt-elements-item-contentAccent shrink-0" />
                            )}
                          </span>
                          {!provider.configured ? (
                            <span className="text-[10px] text-amber-400">API key missing</span>
                          ) : (
                            <span className="text-[10px] text-bolt-elements-textTertiary font-mono tabular-nums">
                              {provider.models.length} models
                            </span>
                          )}
                        </div>
                      </div>

                      <span
                        className={classNames(
                          'i-ph:caret-right text-xs shrink-0 transition-theme',
                          isHovered ? 'text-bolt-elements-item-contentAccent' : 'text-bolt-elements-textTertiary',
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cascading Flyout Submenu (Appears only when hovering/selecting a provider) */}
            {inspectedProviderCatalog && (
              <div
                ref={submenuRef}
                role="menu"
                aria-label={`${inspectedProviderCatalog.name} Models`}
                onMouseEnter={clearHoverCloseTimer}
                onMouseLeave={scheduleHoverClose}
                onKeyDown={handleSubmenuKeyDown}
                style={{
                  position: 'fixed',
                  left: `${submenuPos.left}px`,
                  top: `${submenuPos.top}px`,
                  width: `${submenuPos.width}px`,
                  maxHeight: `${submenuPos.maxHeight}px`,
                  zIndex: 1001,
                  animation: 'fadeInMenu 120ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary shadow-2xl flex flex-col overflow-hidden"
              >
                {/* Header */}
                <div className="px-3 py-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-3/40 space-y-2 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ProviderLogo provider={inspectedProviderCatalog.id} className="w-4 h-4 shrink-0" />
                      <span className="text-xs font-semibold text-bolt-elements-textPrimary truncate">
                        {getProviderDisplayName(inspectedProviderCatalog.id, inspectedProviderCatalog.name)}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-bolt-elements-textTertiary shrink-0">
                      {inspectedProviderCatalog.models.length}
                    </span>
                  </div>

                  {!inspectedProviderCatalog.configured && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-400">
                      Missing{' '}
                      <code className="font-mono font-semibold">
                        {inspectedProviderCatalog.id === 'openrouter'
                          ? 'OPENROUTER_API_KEY'
                          : inspectedProviderCatalog.id === 'groq'
                            ? 'GROQ_API_KEY'
                            : 'GEMINI_API_KEY'}
                      </code>
                    </div>
                  )}

                  {/* Search */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor focus-within:border-bolt-elements-borderColorActive transition-theme">
                    <span className="i-ph:magnifying-glass text-xs text-bolt-elements-textTertiary shrink-0" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search ${inspectedProviderCatalog.name} models...`}
                      className="flex-1 bg-transparent text-xs text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary focus:outline-none min-w-0"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary cursor-pointer"
                        aria-label="Clear search"
                      >
                        <span className="i-ph:x text-xs block" />
                      </button>
                    )}
                  </div>

                  {/* Category Tabs */}
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor overflow-x-auto">
                    {CATEGORY_TABS.map((tab) => {
                      const isActiveTab = categoryFilter === tab.id;
                      const count = categoryCounts[tab.id];

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setCategoryFilter(tab.id)}
                          className={classNames(
                            'px-2 py-1 rounded-md text-[11px] font-medium transition-theme whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer',
                            isActiveTab
                              ? 'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent'
                              : 'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
                          )}
                        >
                          <span>{tab.label}</span>
                          <span className="text-[10px] font-mono tabular-nums opacity-75">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Scrollable Models List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
                  {loading && !loaded ? (
                    <div className="space-y-1.5">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="h-12 rounded-lg bg-bolt-elements-background-depth-3 animate-pulse" />
                      ))}
                    </div>
                  ) : flatSelectableModels.length === 0 ? (
                    <div className="py-8 px-4 text-center space-y-2">
                      <span className="i-ph:magnifying-glass text-lg text-bolt-elements-textTertiary block mx-auto" />
                      <div className="text-xs font-medium text-bolt-elements-textPrimary">No matching models</div>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setCategoryFilter('all');
                        }}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-bolt-elements-button-secondary-background text-bolt-elements-button-secondary-text hover:bg-bolt-elements-button-secondary-backgroundHover transition-theme cursor-pointer"
                      >
                        Reset filters
                      </button>
                    </div>
                  ) : (
                    <>
                      {favoriteModelsList.length > 0 && (
                        <section className="space-y-1">
                          <div className="px-2 flex items-center justify-between text-[10px] font-semibold text-bolt-elements-textTertiary">
                            <span>Favorites</span>
                            <span className="font-mono tabular-nums">{favoriteModelsList.length}</span>
                          </div>
                          {favoriteModelsList.map((model, idx) => (
                            <ModelRow
                              key={`fav-${model.provider}-${model.id}`}
                              model={model}
                              isSelected={selection.provider === model.provider && selection.model === model.id}
                              isHighlighted={highlightedIndex === idx}
                              isFavorite={true}
                              onSelect={handleSelectModel}
                              onToggleFavorite={(m) => toggleFavoriteModel(m.provider, m.id)}
                              onHover={() => setHighlightedIndex(idx)}
                            />
                          ))}
                        </section>
                      )}

                      {recentModelsList.length > 0 && (
                        <section className="space-y-1">
                          <div className="px-2 flex items-center justify-between text-[10px] font-semibold text-bolt-elements-textTertiary">
                            <span>Recently Used</span>
                            <span className="font-mono tabular-nums">{recentModelsList.length}</span>
                          </div>
                          {recentModelsList.map((model, idx) => {
                            const flatIdx = favoriteModelsList.length + idx;
                            return (
                              <ModelRow
                                key={`recent-${model.provider}-${model.id}`}
                                model={model}
                                isSelected={selection.provider === model.provider && selection.model === model.id}
                                isHighlighted={highlightedIndex === flatIdx}
                                isFavorite={favoriteSet.has(makeModelKey(model.provider, model.id))}
                                onSelect={handleSelectModel}
                                onToggleFavorite={(m) => toggleFavoriteModel(m.provider, m.id)}
                                onHover={() => setHighlightedIndex(flatIdx)}
                              />
                            );
                          })}
                        </section>
                      )}

                      <section className="space-y-1">
                        <div className="px-2 flex items-center justify-between text-[10px] font-semibold text-bolt-elements-textTertiary">
                          <span>Models</span>
                          <span className="font-mono tabular-nums">{filteredModels.length}</span>
                        </div>
                        {filteredModels.map((model, idx) => {
                          const flatIdx = favoriteModelsList.length + recentModelsList.length + idx;
                          return (
                            <ModelRow
                              key={`${model.provider}-${model.id}`}
                              model={model}
                              isSelected={selection.provider === model.provider && selection.model === model.id}
                              isHighlighted={highlightedIndex === flatIdx}
                              isFavorite={favoriteSet.has(makeModelKey(model.provider, model.id))}
                              onSelect={handleSelectModel}
                              onToggleFavorite={(m) => toggleFavoriteModel(m.provider, m.id)}
                              onHover={() => setHighlightedIndex(flatIdx)}
                            />
                          );
                        })}
                      </section>
                    </>
                  )}
                </div>
              </div>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
