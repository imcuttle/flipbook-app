// Icon shim — wraps lucide-react so the rest of the codebase only knows
// short stable names. To swap libraries later, change this file only.
import {
  Menu,            // ☰ gallery
  Globe,           // 🌐 web-search ON
  GlobeLock,       // ⊘ web-search OFF
  Share2,          // 🔗 share
  Tag,             // 🏷 labels visible
  TagsIcon,        // (alt for labels off — falls back to Tag with /strikethrough)
  Maximize,        // ⛶ fullscreen
  Minimize,        // ⤢ exit fullscreen
  Eye,             // 👁 chrome on / preview badge
  EyeOff,          // 🚫 chrome off
  Lock,            // 🔒 read-only / preview marker (distinct from Eye)
  X as XIcon,      // ✕ close / delete
  BookOpen,        // 📚 sources
  ListTree,        // 🌳 catalog / tree
  ChevronRight,    // › breadcrumb separator
  Diamond,         // ◆ current-row marker
  Loader2,         // generic spinner
  Paperclip,       // 📎 attach image
  MoreHorizontal,  // ⋯ more / overflow menu
  CornerDownLeft,  // ⏎ submit / enter
  ImagePlus,       // image-with-plus alt for click composer
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const REGISTRY = {
  menu: Menu,
  'web-on': Globe,
  'web-off': GlobeLock,
  share: Share2,
  'tag-on': Tag,
  'tag-off': TagsIcon,
  'fullscreen-enter': Maximize,
  'fullscreen-exit': Minimize,
  eye: Eye,
  'eye-off': EyeOff,
  lock: Lock,
  close: XIcon,
  sources: BookOpen,
  catalog: ListTree,
  chevron: ChevronRight,
  current: Diamond,
  spinner: Loader2,
  attach: Paperclip,
  more: MoreHorizontal,
  submit: CornerDownLeft,
  'image-plus': ImagePlus,
} as const;

export type IconName = keyof typeof REGISTRY;

type Props = Omit<LucideProps, 'ref'> & {
  name: IconName;
};

// Default size matches our 14px button text. Stroke 2px reads well at
// these tiny sizes; pass `size`/`strokeWidth` to override per-call.
export function Icon({ name, size = 16, strokeWidth = 2, ...rest }: Props) {
  const Cmp = REGISTRY[name];
  if (!Cmp) return null;
  return <Cmp size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}
