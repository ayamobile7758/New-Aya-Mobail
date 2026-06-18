// src/components/ui/PinDots.tsx
// =============================================================================
// Shared PIN entry boxes used across every PIN screen (daily lock, admin,
// maintenance, force-change-defaults).
//
// THE EFFECT (idea borrowed from an animated OTP UI, rebuilt in React with
// THIS app's existing theme colors — no new colors introduced):
//   - Separate boxes, one per digit (matches the original design).
//   - A glowing "running line" travels around the *active* box (the next box
//     to be filled) using a masked conic-gradient border in `--color-accent`.
//   - When all digits are entered, every box flashes once (success) right
//     before the screen dismisses.
//
// The box fill / borders stay on the existing palette (accent / border /
// surface / muted), so dropping this in does not change any colors.
// =============================================================================

import { cn } from '@/lib/utils';

interface PinDotsProps {
  /** How many boxes to render. */
  length?: number;
  /** How many boxes are currently filled (typically pin.length). */
  filled: number;
  /** When true, every box plays the success-flash animation once. */
  success?: boolean;
  /** Optional raw value — only used when `reveal` is true to show real digits. */
  value?: string;
  /** Show the actual digit instead of a masked dot. Default: false (secure). */
  reveal?: boolean;
  /** Visual variant: 'lock' (default, larger) or 'setup' (force-change screen). */
  variant?: 'lock' | 'setup';
  className?: string;
}

export function PinDots({
  length = 4,
  filled,
  success = false,
  value = '',
  reveal = false,
  variant = 'lock',
  className,
}: PinDotsProps) {
  const isSetup = variant === 'setup';

  return (
    // dir="ltr" keeps the boxes filling left→right while the page stays RTL.
    <div className={cn('flex justify-center gap-4', className)} dir="ltr">
      {Array.from({ length }).map((_, i) => {
        const isFilled = filled > i;
        // The active box is the next empty one (and only while not yet complete).
        const isActive = !success && i === filled && filled < length;

        return (
          <div
            key={i}
            className={cn(
              'pin-box flex items-center justify-center font-bold transition-all',
              isSetup
                ? 'w-12 h-14 rounded-xl border-2 text-3xl'
                : 'w-14 h-14 rounded-2xl border-2 text-2xl',
              isFilled
                ? 'border-accent bg-accent text-white scale-110' +
                    (isSetup ? ' shadow-lg shadow-accent/20' : '')
                : isSetup
                  ? 'border-border bg-muted text-transparent'
                  : 'border-border bg-surface',
              isActive && 'pin-box-active border-accent',
              success && 'pin-box-success',
            )}
          >
            {isFilled ? (reveal ? value[i] : '•') : isSetup ? '•' : ''}
          </div>
        );
      })}
    </div>
  );
}
