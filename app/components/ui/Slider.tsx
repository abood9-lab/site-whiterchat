import { motion } from 'framer-motion';
import { memo } from 'react';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { genericMemo } from '~/utils/react';

export interface SliderOption<T> {
  value: T;
  text: string;
  icon?: string;
  badge?: string | number;
  title?: string;
}

export interface SliderOptions<T> {
  left: SliderOption<T>;
  right: SliderOption<T>;
}

interface SliderProps<T> {
  selected: T;
  options?: SliderOptions<T>;
  tabs?: SliderOption<T>[];
  setSelected?: (selected: T) => void;
}

export const Slider = genericMemo(<T,>({ selected, options, tabs, setSelected }: SliderProps<T>) => {
  const items: SliderOption<T>[] = tabs ?? (options ? [options.left, options.right] : []);

  return (
    <div
      role="tablist"
      className="inline-flex items-center shrink-0 gap-0.5 bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor overflow-x-auto rounded-lg p-1"
    >
      {items.map((item) => {
        const isSelected = selected === item.value;

        return (
          <SliderButton
            key={String(item.value)}
            selected={isSelected}
            title={item.title}
            setSelected={() => setSelected?.(item.value)}
          >
            {item.icon ? <span className={classNames(item.icon, 'text-sm shrink-0')} /> : null}
            <span className="whitespace-nowrap">{item.text}</span>
            {item.badge !== undefined && item.badge !== '' ? (
              <span className="font-mono tabular-nums text-[11px] opacity-80">{item.badge}</span>
            ) : null}
          </SliderButton>
        );
      })}
    </div>
  );
});

interface SliderButtonProps {
  selected: boolean;
  title?: string;
  children: React.ReactNode;
  setSelected: () => void;
}

const SliderButton = memo(({ selected, title, children, setSelected }: SliderButtonProps) => {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={title}
      onClick={setSelected}
      className={classNames(
        'bg-transparent text-xs sm:text-sm font-medium px-2.5 py-1 rounded-md relative inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors',
        selected
          ? 'text-bolt-elements-item-contentAccent'
          : 'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive',
      )}
    >
      <span className="relative z-10 inline-flex items-center gap-1.5">{children}</span>
      {selected && (
        <motion.span
          layoutId="workbench-tab-highlight"
          transition={{ duration: 0.2, ease: cubicEasingFn }}
          className="absolute inset-0 z-0 bg-bolt-elements-item-backgroundAccent rounded-md"
        />
      )}
    </button>
  );
});

