import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowDownToLine,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Home as HomeIcon,
  Layers3,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

type Mode = 'work' | 'home' | 'transition';
type TransitionDirection = 'go-home' | 'start-work';
type Adjustment = Mode | 'flip';
type BlockColor = '#534AB7' | '#0F6E56' | '#D85A30' | '#993556' | '#185FA5' | '#3B6D11' | '#854F0B' | '#A32D2D' | '#5F5E5A';
type Block = { id: string; date: string; startTime: string; endTime: string; title: string; color: BlockColor };
type HitchConfig = { cycleStartDate: string; workPhaseLength: number; homePhaseLength: number; defaultNightShift: boolean; goHomeTransitionHour: number; startWorkTransitionHour: number };
type HitchOverride = { id: string; startDate: string; endDate: string; label: string; adjustment: Adjustment };
type DaySettings = { transitionHour?: number; nightShiftOverride: boolean | null };
type Template = { id: string; name: string; blocks: Omit<Block, 'id' | 'date'>[] };

const colors: { value: BlockColor; label: string }[] = [
  { value: '#534AB7', label: 'Purple' }, { value: '#0F6E56', label: 'Teal' },
  { value: '#D85A30', label: 'Coral' }, { value: '#993556', label: 'Pink' },
  { value: '#185FA5', label: 'Blue' }, { value: '#3B6D11', label: 'Green' },
  { value: '#854F0B', label: 'Amber' }, { value: '#A32D2D', label: 'Red' },
  { value: '#5F5E5A', label: 'Gray' },
];

const todayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const toDateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (value: string, amount: number) => {
  const date = parseDate(value); date.setDate(date.getDate() + amount); return toDateString(date);
};
const diffDays = (from: string, to: string) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);
const cycleIndex = (value: number, total: number) => ((value % total) + total) % total;
const formatLongDate = (value: string) => parseDate(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const formatShortDate = (value: string) => parseDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const monthTitle = (date: Date) => date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
const timeLabel = (value: string) => {
  const [h, m] = value.split(':').map(Number); const suffix = h >= 12 ? 'PM' : 'AM'; const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

const initialConfig: HitchConfig = { cycleStartDate: todayString(), workPhaseLength: 14, homePhaseLength: 14, defaultNightShift: false, goHomeTransitionHour: 6, startWorkTransitionHour: 6 };
const emptyState = { config: initialConfig, blocks: [] as Block[], overrides: [] as HitchOverride[], daySettings: {} as Record<string, DaySettings>, templates: [] as Template[] };
const normalizeHour = (value: unknown, fallback: number) => Number.isFinite(Number(value)) ? Math.min(23, Math.max(0, Number(value))) : fallback;
const normalizeConfig = (value: Partial<HitchConfig>): HitchConfig => ({
  ...initialConfig,
  ...value,
  workPhaseLength: Math.max(1, Number(value.workPhaseLength ?? initialConfig.workPhaseLength)),
  homePhaseLength: Math.max(1, Number(value.homePhaseLength ?? initialConfig.homePhaseLength)),
  goHomeTransitionHour: normalizeHour(value.goHomeTransitionHour, initialConfig.goHomeTransitionHour),
  startWorkTransitionHour: normalizeHour(value.startWorkTransitionHour, initialConfig.startWorkTransitionHour),
});
const readStore = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(`hitch-planner:${key}`); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};
const persist = (key: string, value: unknown) => localStorage.setItem(`hitch-planner:${key}`, JSON.stringify(value));

function automaticTransitionDirection(date: string, config: HitchConfig): TransitionDirection | null {
  const total = config.workPhaseLength + config.homePhaseLength;
  const phase = cycleIndex(diffDays(config.cycleStartDate, date), total) % total;
  if (phase === config.workPhaseLength - 1) return 'go-home';
  if (phase === 0) return 'start-work';
  return null;
}

function getTransitionDirection(date: string, config: HitchConfig, overrides: HitchOverride[]): TransitionDirection | null {
  const override = overrides.find((item) => date >= item.startDate && date <= item.endDate);
  if (override) return override.adjustment === 'transition' ? 'go-home' : null;
  return automaticTransitionDirection(date, config);
}

function transitionHourFor(date: string, config: HitchConfig, overrides: HitchOverride[], daySettings?: DaySettings): number {
  if (daySettings?.transitionHour !== undefined) return normalizeHour(daySettings.transitionHour, config.goHomeTransitionHour);
  return getTransitionDirection(date, config, overrides) === 'start-work'
    ? config.startWorkTransitionHour
    : config.goHomeTransitionHour;
}

function transitionStyleFor(date: string, config: HitchConfig, overrides: HitchOverride[]): CSSProperties | undefined {
  const direction = getTransitionDirection(date, config, overrides);
  if (!direction) return undefined;
  return { '--transition-position': `${(transitionHourFor(date, config, overrides) / 24) * 100}%` } as CSSProperties;
}

function resolveMode(date: string, config: HitchConfig, overrides: HitchOverride[]): Mode {
  const override = overrides.find((item) => date >= item.startDate && date <= item.endDate);
  const total = config.workPhaseLength + config.homePhaseLength;
  const cycle = cycleIndex(diffDays(config.cycleStartDate, date), total);
  const phase = cycle % (config.workPhaseLength + config.homePhaseLength);
  let mode: Mode = phase < config.workPhaseLength ? 'work' : 'home';
  if (override?.adjustment === 'flip') mode = mode === 'work' ? 'home' : 'work';
  if (override?.adjustment === 'work' || override?.adjustment === 'home' || override?.adjustment === 'transition') mode = override.adjustment;
  if (!override && automaticTransitionDirection(date, config)) mode = 'transition';
  return mode;
}

function AppShell({ children, mode }: { children: ReactNode; mode: Mode }) {
  const [location] = useLocation();
  const nav = [
    { href: '/', label: 'Today', icon: Clock3 },
    { href: '/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/hitch', label: 'Hitch', icon: Layers3 },
    { href: '/settings', label: 'Settings', icon: Settings2 },
  ];
  return (
    <div className="app-shell noise min-h-[100dvh]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px]">
        <aside className="desktop-sidebar w-[224px] shrink-0 flex-col border-r border-white/[.08] px-5 py-7">
          <Link href="/" className="mb-12 flex items-center gap-3 text-foreground no-underline" data-testid="link-brand">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_8px_25px_hsl(17_75%_61%/.2)]">
              <ArrowDownToLine size={18} strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg font-bold tracking-[-.04em]">Hitch<span className="text-primary">.</span></span>
          </Link>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = location === href;
              return <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold no-underline transition-colors ${active ? 'bg-white/[.09] text-foreground' : 'text-muted-foreground hover:bg-white/[.05] hover:text-foreground'}`}>
                <Icon size={17} strokeWidth={active ? 2.3 : 1.8} className={active ? 'text-primary' : 'transition-colors group-hover:text-primary'} />
                {label}
              </Link>;
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/[.08] bg-white/[.035] p-4">
            <div className="mb-3 flex items-center justify-between"><span className="font-mono-app text-[9px] uppercase tracking-[.16em] text-muted-foreground">Schedule</span><span className="h-2 w-2 rounded-full bg-muted-foreground" /></div>
            <p className="font-display text-sm font-semibold">{mode === 'work' ? 'On the clock' : mode === 'home' ? 'Back at base' : 'Changeover day'}</p>
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-24 md:pb-10">
          <header className="flex items-center justify-between px-5 py-5 md:px-10 md:py-7">
            <div className="flex items-center gap-2 md:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ArrowDownToLine size={16} /></span>
              <span className="font-display font-bold">Hitch<span className="text-primary">.</span></span>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-secondary" /><span>Saved</span></div>
          </header>
          <div className="px-5 md:px-10">{children}</div>
        </main>
      </div>
      <nav className="mobile-nav fixed inset-x-3 bottom-3 z-40 justify-around rounded-2xl border border-white/[.12] bg-[hsl(222_24%_12%/.94)] p-2 shadow-2xl backdrop-blur-xl">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = location === href;
          return <Link key={href} href={href} data-testid={`mobile-nav-${label.toLowerCase()}`} className={`flex min-w-[62px] flex-col items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-semibold no-underline ${active ? 'bg-white/[.1] text-foreground' : 'text-muted-foreground'}`}>
            <Icon size={17} className={active ? 'text-primary' : ''} /><span>{label}</span>
          </Link>;
        })}
      </nav>
    </div>
  );
}

function PhaseBadge({ mode }: { mode: Mode }) {
  const Icon = mode === 'work' ? BriefcaseBusiness : mode === 'home' ? HomeIcon : RotateCcw;
  return <span data-testid={`status-phase-${mode}`} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.12] bg-white/[.06] px-2.5 py-1 font-mono-app text-[10px] uppercase tracking-[.12em] text-foreground"><Icon size={12} />{mode}</span>;
}

function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const selected = parseDate(date);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const first = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, index) => {
    const day = index - first + 1;
    return day > 0 && day <= days
      ? toDateString(new Date(month.getFullYear(), month.getMonth(), day))
      : null;
  });

  useEffect(() => {
    const selected = parseDate(date);
    setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [date]);

  return <div className="relative">
    <button
      type="button"
      aria-label={`Choose date, currently ${formatLongDate(date)}`}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      data-testid="button-open-date-picker"
      className="flex items-center gap-2 rounded-xl border border-white/[.1] bg-white/[.045] px-3 py-2.5 font-mono-app text-[10px] uppercase tracking-[.12em] text-muted-foreground transition hover:bg-white/[.08] hover:text-foreground"
    >
      <CalendarDays size={15} className="text-primary" />
      <span>{formatShortDate(date)}</span>
    </button>
    {open && <div className="absolute right-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-4 shadow-2xl backdrop-blur-xl" data-testid="date-picker-popover">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-sm font-bold">{monthTitle(month)}</p>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronLeft size={15} /></button>
          <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={`${day}-${index}`} className="pb-1 font-mono-app text-[9px] text-muted-foreground">{day}</span>)}
        {cells.map((cell, index) => cell ? <button type="button" key={cell} onClick={() => { onChange(cell); setOpen(false); }} data-testid={`date-picker-day-${cell}`} className={`flex h-8 items-center justify-center rounded-lg text-xs transition hover:bg-white/[.1] ${cell === date ? 'bg-primary font-bold text-primary-foreground' : cell === todayString() ? 'border border-primary/50 text-primary' : 'text-foreground/80'}`}>{parseDate(cell).getDate()}</button> : <span key={`empty-${index}`} />)}
      </div>
      <button type="button" onClick={() => { onChange(todayString()); setOpen(false); }} data-testid="button-date-picker-today" className="mt-3 w-full rounded-lg border border-white/[.1] py-2 text-xs font-semibold text-muted-foreground transition hover:bg-white/[.06] hover:text-foreground">Jump to today</button>
    </div>}
  </div>;
}

function BlockModal({ block, date, onClose, onSave, onDelete }: { block?: Block; date: string; onClose: () => void; onSave: (data: Omit<Block, 'id' | 'date'>) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(block?.title ?? '');
  const [startTime, setStartTime] = useState(block?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(block?.endTime ?? '09:00');
  const [color, setColor] = useState<BlockColor>(block?.color ?? '#D85A30');
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), startTime, endTime, color }); };
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#080b10]/75 p-3 backdrop-blur-sm sm:items-center">
    <form onSubmit={submit} className="modal-panel w-full max-w-md rounded-[1.5rem] border border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7" data-testid="form-block-modal">
      <div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">{block ? 'Edit block' : 'New block'}</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">{formatShortDate(date)}</h2></div><button type="button" onClick={onClose} aria-label="Close block dialog" data-testid="button-close-block-dialog" className="rounded-full p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><X size={18} /></button></div>
      <label className="mb-5 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">What needs your attention?</span><input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Toolbox talk" data-testid="input-block-title" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3.5 py-3 text-sm outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/70 focus:ring-2 focus:ring-primary/15" /></label>
      <div className="mb-5 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Starts</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} data-testid="input-block-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Ends</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} data-testid="input-block-end" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label></div>
      <div className="mb-7"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Color marker</span><div className="flex flex-wrap gap-2">{colors.map((item) => <button type="button" key={item.value} aria-label={`Use ${item.label} color`} onClick={() => setColor(item.value)} data-testid={`button-color-${item.label.toLowerCase()}`} className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${color === item.value ? 'border-foreground ring-2 ring-foreground/20' : 'border-transparent'}`} style={{ backgroundColor: item.value }} />)}</div></div>
      <div className="flex items-center justify-between gap-3">{onDelete && <button type="button" onClick={() => { if (window.confirm('Delete this block from the day?')) onDelete(); }} data-testid="button-delete-block" className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold text-[#ee8f7e] hover:bg-primary/10"><Trash2 size={15} />Delete</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} data-testid="button-cancel-block" className="rounded-xl px-4 py-3 text-xs font-semibold text-muted-foreground hover:bg-white/[.06]">Cancel</button><button type="submit" data-testid="button-save-block" className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground transition hover:brightness-110"><Check size={15} />{block ? 'Save changes' : 'Add to day'}</button></div></div>
    </form>
  </div>;
}

function Timeline({ date, blocks, config, overrides, daySettings, mode, onAdd, onEdit }: { date: string; blocks: Block[]; config: HitchConfig; overrides: HitchOverride[]; daySettings?: DaySettings; mode: Mode; onAdd: () => void; onEdit: (block: Block) => void }) {
  const nightShift = daySettings?.nightShiftOverride ?? config.defaultNightShift;
  const direction = mode === 'transition' ? getTransitionDirection(date, config, overrides) : null;
  const transitionHour = transitionHourFor(date, config, overrides, daySettings);
  const timelineStyle = mode === 'transition' ? { '--transition-position': `${(transitionHour / 24) * 100}%` } as CSSProperties : undefined;
  const timelineClass = mode === 'work' ? 'timeline-day-work' : mode === 'home' ? 'timeline-day-home' : `timeline-day-transition ${direction === 'start-work' ? 'timeline-day-transition-start' : ''}`;
  const hours = Array.from({ length: 9 }, (_, i) => i * 3);
  return <section className="mt-7 overflow-hidden rounded-2xl border border-white/[.1] bg-black/[.14]">
    <div className="flex items-center justify-between border-b border-white/[.08] px-4 py-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" /><span>24-hour view</span>{nightShift && <span className="rounded-full bg-accent/10 px-2 py-1 font-mono-app text-[9px] uppercase tracking-[.1em] text-[#efc166]">Night shift · noon to noon</span>}</div><button type="button" onClick={onAdd} data-testid="button-add-block" className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:brightness-110"><Plus size={15} />Add block</button></div>
    <div className={`relative flex min-h-[730px] px-3 py-5 sm:px-5 ${timelineClass}`} style={timelineStyle}>
      <div className="w-14 shrink-0 sm:w-20">{hours.map((hour) => <div key={hour} className="h-[88px] -translate-y-2 font-mono-app text-[10px] text-muted-foreground">{hour === 0 ? '12 AM' : hour === 12 ? '12 PM' : `${hour > 12 ? hour - 12 : hour} ${hour > 12 ? 'PM' : 'AM'}`}</div>)}</div>
      <div className="timeline-grid relative min-h-[704px] flex-1 border-l border-white/[.1]">
        {nightShift && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1/2 bg-accent/[.025]" />}
        {blocks.length === 0 && <div className="absolute inset-x-4 top-[25%] text-center"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[.1] bg-white/[.04] text-muted-foreground"><Sun size={19} /></div><p className="font-display text-sm font-semibold">A clear run ahead</p><button type="button" onClick={onAdd} data-testid="button-add-first-block" className="mt-4 text-xs font-bold text-primary hover:underline">Add your first block</button></div>}
        {blocks.map((block) => {
          const start = minutes(block.startTime); const end = Math.max(start + 30, minutes(block.endTime)); const top = (start / 1440) * 100; const height = ((end - start) / 1440) * 100;
          return <button type="button" key={block.id} onClick={() => onEdit(block)} data-testid={`card-block-${block.id}`} className="event-card absolute left-3 right-3 z-10 overflow-hidden rounded-xl border border-white/20 px-3 py-2 text-left shadow-lg" style={{ top: `${top}%`, height: `max(42px, ${height}%)`, backgroundColor: `${block.color}dd`, borderLeft: `4px solid ${block.color}` }}>
            <span className="block truncate text-sm font-bold text-white">{block.title}</span><span className="mt-0.5 block font-mono-app text-[10px] text-white/75">{timeLabel(block.startTime)} — {timeLabel(block.endTime)}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}

function TodayPage({ config, blocks, overrides, daySettings, onCreateBlock, onUpdateBlock, onDeleteBlock, onSetDaySettings }: { config: HitchConfig; blocks: Block[]; overrides: HitchOverride[]; daySettings: Record<string, DaySettings>; onCreateBlock: (date: string, data: Omit<Block, 'id' | 'date'>) => void; onUpdateBlock: (id: string, data: Omit<Block, 'id' | 'date'>) => void; onDeleteBlock: (id: string) => void; onSetDaySettings: (date: string, settings: DaySettings) => void }) {
  const [location] = useLocation(); const queryDate = new URLSearchParams(location.split('?')[1] ?? '').get('date'); const [date, setDate] = useState(queryDate ?? todayString()); const [editing, setEditing] = useState<Block>();
  const [adding, setAdding] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false);
   const mode = resolveMode(date, config, overrides); const dateBlocks = blocks.filter((block) => block.date === date).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
  const settings = daySettings[date]; const isToday = date === todayString(); const nightShift = settings?.nightShiftOverride ?? config.defaultNightShift;
  useEffect(() => { setDate(queryDate ?? todayString()); }, [location, queryDate]);
  return <AppShell mode={mode}><div className="fade-in mx-auto max-w-[1040px]">
    <div className="flex flex-col justify-between gap-5 border-b border-white/[.09] pb-7 sm:flex-row sm:items-end"><div><div className="mb-4 flex items-center gap-3"><PhaseBadge mode={mode} />{isToday && <span className="font-mono-app text-[10px] uppercase tracking-[.15em] text-muted-foreground">Live date</span>}</div><h1 data-testid="text-today-date" className="font-display text-[clamp(2.2rem,7vw,4.4rem)] font-bold leading-[.95] tracking-[-.07em]">{formatLongDate(date)}</h1></div><div className="flex items-center gap-2 self-end"><DatePicker date={date} onChange={setDate} /><div className="relative"><button type="button" aria-label="Open day settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} data-testid="button-open-day-settings" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.1] bg-white/[.045] text-muted-foreground transition hover:bg-white/[.08] hover:text-foreground"><Settings size={16} /></button>{settingsOpen && <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-4 shadow-2xl backdrop-blur-xl" data-testid="day-settings-popover"><div className="mb-4 flex items-center justify-between"><span className="font-display text-sm font-bold">Day settings</span><span className="font-mono-app text-[9px] text-muted-foreground">{dateBlocks.length} {dateBlocks.length === 1 ? 'block' : 'blocks'}</span></div><label className="block"><span className="mb-2 block text-[11px] font-semibold text-muted-foreground">Transition hour</span><select value={settings?.transitionHour ?? transitionHourFor(date, config, overrides)} onChange={(event) => onSetDaySettings(date, { transitionHour: Number(event.target.value), nightShiftOverride: settings?.nightShiftOverride ?? null })} data-testid="select-transition-hour" className="w-full rounded-lg border border-white/[.1] bg-black/[.2] px-2 py-2 font-mono-app text-[10px] text-foreground outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label><button type="button" onClick={() => onSetDaySettings(date, { transitionHour: settings?.transitionHour, nightShiftOverride: !nightShift })} data-testid="button-toggle-date-night" className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/[.1] bg-white/[.035] px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-white/[.07]"><span className="flex items-center gap-2"><Moon size={14} className={nightShift ? 'text-accent' : ''} />Night shift</span><span className={nightShift ? 'text-accent' : 'text-muted-foreground'}>{nightShift ? 'On' : 'Off'}</span></button></div>}</div></div></div>
     <Timeline date={date} blocks={dateBlocks} config={config} overrides={overrides} daySettings={settings} mode={mode} onAdd={() => setAdding(true)} onEdit={setEditing} />
    {adding && <BlockModal date={date} onClose={() => setAdding(false)} onSave={(data) => { onCreateBlock(date, data); setAdding(false); }} />}
    {editing && <BlockModal block={editing} date={date} onClose={() => setEditing(undefined)} onSave={(data) => { onUpdateBlock(editing.id, data); setEditing(undefined); }} onDelete={() => { onDeleteBlock(editing.id); setEditing(undefined); }} />}
  </div></AppShell>;
}

function CalendarPage({ config, blocks, overrides }: { config: HitchConfig; blocks: Block[]; overrides: HitchOverride[] }) {
  const [, navigate] = useLocation(); const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const start = new Date(month.getFullYear(), month.getMonth(), 1); const first = (start.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => { const n = i - first + 1; return n > 0 && n <= days ? toDateString(new Date(month.getFullYear(), month.getMonth(), n)) : null; });
  const todayMode = resolveMode(todayString(), config, overrides);
  return <AppShell mode={todayMode}><div className="fade-in mx-auto max-w-[1100px]">
    <div className="flex flex-col justify-between gap-4 border-b border-white/[.09] pb-7 sm:flex-row sm:items-end"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">The wider view</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">Calendar<span className="text-primary">.</span></h1></div><div className="flex items-center gap-2"><button type="button" onClick={() => setMonth(new Date())} data-testid="button-calendar-today" className="rounded-xl border border-white/[.1] px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-white/[.06] hover:text-foreground">This month</button><div className="flex rounded-xl border border-white/[.1] bg-white/[.04] p-1"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" data-testid="button-previous-month" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronLeft size={16} /></button><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" data-testid="button-next-month" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronRight size={16} /></button></div></div></div>
    <div className="mt-8 flex items-center justify-between"><h2 data-testid="text-calendar-month" className="font-display text-2xl font-bold tracking-[-.04em]">{monthTitle(month)}</h2><div className="flex gap-3 font-mono-app text-[9px] uppercase tracking-[.12em] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Work</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-secondary" />Home</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-accent" />Transition</span></div></div>
     <div className="mt-4 overflow-hidden rounded-2xl border border-white/[.1] bg-black/[.12]"><div className="grid grid-cols-7 border-b border-white/[.1]">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="px-2 py-3 text-center font-mono-app text-[9px] uppercase tracking-[.14em] text-muted-foreground sm:px-4 sm:text-left">{day}</div>)}</div><div className="grid grid-cols-7">{cells.map((date, index) => { const cellBlocks = date ? blocks.filter((block) => block.date === date) : []; const mode = date ? resolveMode(date, config, overrides) : 'home'; const direction = date && mode === 'transition' ? getTransitionDirection(date, config, overrides) : null; const today = date === todayString(); return <button type="button" disabled={!date} key={`${date}-${index}`} onClick={() => date && navigate(`/?date=${date}`)} data-testid={date ? `calendar-day-${date}` : `calendar-empty-${index}`} style={date && mode === 'transition' ? transitionStyleFor(date, config, overrides) : undefined} className={`relative min-h-[96px] border-b border-r border-white/[.07] p-2 text-left transition last:border-r-0 sm:min-h-[130px] sm:p-3 ${date ? mode === 'work' ? 'mode-cell-work hover:brightness-110' : mode === 'home' ? 'mode-cell-home hover:brightness-110' : `mode-cell-transition ${direction === 'start-work' ? 'mode-cell-transition-start' : ''} hover:brightness-110` : 'bg-white/[.012]'} ${today ? 'ring-1 ring-inset ring-foreground/80' : ''}`}>{date && <><div className="flex items-center justify-between"><span className={`font-display text-sm font-bold ${today ? 'flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground' : ''}`}>{parseDate(date).getDate()}</span>{cellBlocks.length > 0 && <span className="font-mono-app text-[9px] text-foreground/75">{cellBlocks.length}</span>}</div><div className={`absolute bottom-0 left-0 right-0 h-0.5 ${mode === 'work' ? 'bg-[#f0a38e]' : mode === 'home' ? 'bg-[#8fd8c3]' : 'bg-accent'}`} />{cellBlocks.slice(0, 2).map((block) => <div key={block.id} className="mt-2 truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white/90" style={{ backgroundColor: `${block.color}bb` }}>{block.title}</div>)}</>}</button>; })}</div></div>
  </div></AppShell>;
}

function HitchPage({ config, blocks, overrides }: { config: HitchConfig; blocks: Block[]; overrides: HitchOverride[] }) {
  const [, navigate] = useLocation(); const total = config.workPhaseLength + config.homePhaseLength; const start = config.cycleStartDate; const today = todayString();
  const cycleOffset = cycleIndex(diffDays(start, today), total);
  const baseMode: Mode = cycleOffset < config.workPhaseLength ? 'work' : 'home';
  const phaseOffset = baseMode === 'work' ? cycleOffset : cycleOffset - config.workPhaseLength;
  const phaseLength = baseMode === 'work' ? config.workPhaseLength : config.homePhaseLength;
  const phaseStart = addDays(start, cycleOffset - phaseOffset);
  const days = Array.from({ length: phaseLength }, (_, i) => ({ date: addDays(phaseStart, i), index: i }));
  const todayMode = resolveMode(today, config, overrides);
  return <AppShell mode={todayMode}><div className="fade-in mx-auto max-w-[1100px]">
    <div className="flex flex-col justify-between gap-5 border-b border-white/[.09] pb-7 sm:flex-row sm:items-end"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">Current phase</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">{baseMode === 'work' ? 'Work' : 'Home'}<span className="text-primary">.</span></h1></div><div className="rounded-2xl border border-white/[.1] bg-white/[.045] px-4 py-3"><p className="font-mono-app text-[9px] uppercase tracking-[.15em] text-muted-foreground">Day in cycle</p><p data-testid="text-cycle-position" className="mt-1 font-display text-2xl font-bold">{phaseOffset + 1}<span className="text-base text-muted-foreground"> / {phaseLength}</span></p></div></div>
    <div className={`mt-8 rounded-2xl border p-5 ${baseMode === 'work' ? 'border-primary/20 bg-primary/[.08]' : 'border-secondary/25 bg-secondary/[.09]'}`}><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-bold">{baseMode === 'work' ? <BriefcaseBusiness size={16} className="text-primary" /> : <HomeIcon size={16} className="text-secondary-foreground" />}<span>{baseMode === 'work' ? 'Work phase' : 'Home phase'}</span></div><span className={`font-mono-app text-[10px] ${baseMode === 'work' ? 'text-primary' : 'text-[#74c8b3]'}`}>{phaseLength} days</span></div><div className="mt-4 h-2 rounded-full bg-black/20"><div className={`h-2 rounded-full ${baseMode === 'work' ? 'bg-primary' : 'bg-secondary'}`} style={{ width: `${((phaseOffset + 1) / phaseLength) * 100}%` }} /></div><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Day {phaseOffset + 1} of {phaseLength}</span><span>{formatShortDate(phaseStart)} — {formatShortDate(addDays(phaseStart, phaseLength - 1))}</span></div></div>
    <div className="mt-8 flex items-center justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-muted-foreground">Phase days</p><h2 className="mt-2 font-display text-xl font-bold">{phaseLength} days</h2></div></div>
     <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-14">{days.map(({ date, index }) => { const isToday = date === today; const count = blocks.filter((block) => block.date === date).length; return <button type="button" key={date} onClick={() => navigate(`/?date=${date}`)} data-testid={`hitch-day-${date}`} className={`group relative min-h-[92px] rounded-xl border bg-white/[.035] p-2 text-left text-foreground transition hover:-translate-y-0.5 hover:bg-white/[.07] ${isToday ? 'border-foreground/80 ring-1 ring-foreground/80' : 'border-white/[.1]'}`}><span className="font-mono-app text-[9px] text-foreground/70">DAY {index + 1}</span><span className={`mt-2 block font-display text-xl font-bold ${isToday ? 'text-foreground' : 'text-foreground/90'}`}>{parseDate(date).getDate()}</span>{count > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}</button>; })}</div>
    <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${baseMode === 'work' ? 'bg-primary' : 'bg-secondary'}`} />{baseMode === 'work' ? 'Work' : 'Home'}</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-accent" />Scheduled blocks</span></div>
  </div></AppShell>;
}

function SettingsPage({ config, setConfig, overrides, setOverrides, daySettings, setDaySettings, templates, setTemplates, blocks, setBlocks }: { config: HitchConfig; setConfig: (config: HitchConfig) => void; overrides: HitchOverride[]; setOverrides: (items: HitchOverride[]) => void; daySettings: Record<string, DaySettings>; setDaySettings: (items: Record<string, DaySettings>) => void; templates: Template[]; setTemplates: (items: Template[]) => void; blocks: Block[]; setBlocks: (items: Block[]) => void }) {
  const [draft, setDraft] = useState(config); const [overrideOpen, setOverrideOpen] = useState(false); const [overrideDraft, setOverrideDraft] = useState({ startDate: todayString(), endDate: todayString(), label: '', adjustment: 'flip' as Adjustment }); const [templateName, setTemplateName] = useState('');
  const saveConfig = () => { const next = normalizeConfig({ ...draft, defaultNightShift: config.defaultNightShift }); setDraft(next); setConfig(next); };
  const addOverride = (event: FormEvent) => { event.preventDefault(); if (!overrideDraft.label.trim()) return; setOverrides([...overrides, { ...overrideDraft, id: uid(), label: overrideDraft.label.trim() }]); setOverrideOpen(false); setOverrideDraft({ startDate: todayString(), endDate: todayString(), label: '', adjustment: 'flip' }); };
  const saveTemplate = () => { const sampleDate = todayString(); const source = blocks.filter((block) => block.date === sampleDate).map(({ id, date, ...rest }) => rest); if (!templateName.trim() || source.length === 0) return; setTemplates([...templates, { id: uid(), name: templateName.trim(), blocks: source }]); setTemplateName(''); };
  const applyTemplate = (template: Template) => { const date = todayString(); const without = blocks.filter((block) => block.date !== date); const applied = template.blocks.map((block) => ({ ...block, id: uid(), date })); setBlocks([...without, ...applied]); };
  const toggleDayNight = () => { const date = todayString(); const current = daySettings[date]?.nightShiftOverride ?? config.defaultNightShift; setDaySettings({ ...daySettings, [date]: { transitionHour: daySettings[date]?.transitionHour, nightShiftOverride: !current } }); };
  return <AppShell mode={resolveMode(todayString(), config, overrides)}><div className="fade-in mx-auto max-w-[960px]">
    <div className="border-b border-white/[.09] pb-7"><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">Tune the cockpit</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">Settings<span className="text-primary">.</span></h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Your defaults live on this device. No account, no sync, no surprises.</p></div>
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
       <div className="space-y-6">
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">01 / rhythm</p><h2 className="mt-2 font-display text-xl font-bold">Cycle configuration</h2><p className="mt-1 text-xs text-muted-foreground">Set the anchor day, rotation, and daily color changeover.</p></div><SlidersHorizontal size={20} className="text-muted-foreground" /></div><label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Cycle starts</span><input type="date" value={draft.cycleStartDate} onChange={(e) => setDraft({ ...draft, cycleStartDate: e.target.value })} data-testid="input-cycle-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Work days</span><input type="number" min="1" max="90" value={draft.workPhaseLength} onChange={(e) => setDraft({ ...draft, workPhaseLength: Number(e.target.value) })} data-testid="input-work-length" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Home days</span><input type="number" min="1" max="90" value={draft.homePhaseLength} onChange={(e) => setDraft({ ...draft, homePhaseLength: Number(e.target.value) })} data-testid="input-home-length" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Go Home color change</span><select value={draft.goHomeTransitionHour} onChange={(e) => setDraft({ ...draft, goHomeTransitionHour: Number(e.target.value) })} data-testid="select-go-home-transition-hour" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 font-mono-app text-xs outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Start Work color change</span><select value={draft.startWorkTransitionHour} onChange={(e) => setDraft({ ...draft, startWorkTransitionHour: Number(e.target.value) })} data-testid="select-start-work-transition-hour" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 font-mono-app text-xs outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label></div><button type="button" onClick={saveConfig} data-testid="button-save-cycle" className="mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground hover:brightness-110"><Save size={15} />Save cycle</button></section>
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">02 / defaults</p><h2 className="mt-2 font-display text-xl font-bold">Shift behavior</h2></div><Moon size={20} className="text-accent" /></div><button type="button" onClick={() => setConfig({ ...config, defaultNightShift: !config.defaultNightShift })} data-testid="button-toggle-night-shift" className="flex w-full items-center justify-between rounded-xl border border-white/[.1] bg-black/[.14] p-4 text-left transition hover:bg-white/[.05]"><span><span className="block text-sm font-semibold">Night-shift default</span><span className="mt-1 block text-xs text-muted-foreground">Treat noon-to-noon as the working window</span></span><span className={`relative h-6 w-11 rounded-full transition ${config.defaultNightShift ? 'bg-accent' : 'bg-white/[.16]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-foreground transition ${config.defaultNightShift ? 'left-6' : 'left-1'}`} /></span></button><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Today’s override</span><button type="button" onClick={toggleDayNight} data-testid="button-toggle-today-night" className="font-semibold text-primary hover:underline">{daySettings[todayString()]?.nightShiftOverride ?? config.defaultNightShift ? 'Night shift on' : 'Day shift on'}</button></div></section>
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">03 / exceptions</p><h2 className="mt-2 font-display text-xl font-bold">Manual overrides</h2><p className="mt-1 text-xs text-muted-foreground">One-off changes win over your normal rotation.</p></div><CalendarRange size={20} className="text-muted-foreground" /></div>{overrides.length === 0 && <div className="rounded-xl border border-dashed border-white/[.14] p-4 text-xs leading-5 text-muted-foreground">No overrides yet. Use one for travel, training, or an unexpected changeover.</div>}<div className="space-y-2">{overrides.map((item) => <div key={item.id} data-testid={`row-override-${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-black/[.12] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.label}</p><p className="mt-1 font-mono-app text-[10px] text-muted-foreground">{formatShortDate(item.startDate)} — {formatShortDate(item.endDate)} · {item.adjustment}</p></div><button type="button" onClick={() => { if (window.confirm(`Remove ${item.label}?`)) setOverrides(overrides.filter((override) => override.id !== item.id)); }} aria-label={`Remove ${item.label}`} data-testid={`button-delete-override-${item.id}`} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-[#ef927e]"><Trash2 size={15} /></button></div>)}</div><button type="button" onClick={() => setOverrideOpen(true)} data-testid="button-add-override" className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.12] px-3 py-2.5 text-xs font-bold hover:bg-white/[.06]"><Plus size={15} />Add override</button></section>
      </div>
      <div className="space-y-6">
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">04 / templates</p><h2 className="mt-2 font-display text-xl font-bold">Reusable days</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Save today’s blocks as a repeatable starting point.</p></div><Copy size={20} className="text-muted-foreground" /></div><div className="flex gap-2"><input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" data-testid="input-template-name" className="min-w-0 flex-1 rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-xs outline-none focus:border-primary/70" /><button type="button" onClick={saveTemplate} data-testid="button-save-template" className="rounded-xl bg-secondary px-3 text-xs font-bold text-secondary-foreground hover:brightness-110">Save</button></div>{blocks.filter((block) => block.date === todayString()).length === 0 && <p className="mt-3 text-[11px] text-muted-foreground">Add at least one block to today before saving a template.</p>}<div className="mt-4 space-y-2">{templates.length === 0 && <div className="rounded-xl border border-dashed border-white/[.14] p-4 text-xs text-muted-foreground">Your saved day patterns will appear here.</div>}{templates.map((template) => <div key={template.id} className="flex items-center justify-between rounded-xl border border-white/[.08] bg-black/[.12] p-3"><div><p className="text-sm font-semibold">{template.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{template.blocks.length} blocks</p></div><div className="flex gap-1"><button type="button" onClick={() => applyTemplate(template)} data-testid={`button-apply-template-${template.id}`} className="rounded-lg px-2.5 py-2 text-[10px] font-bold text-primary hover:bg-primary/10">Apply today</button><button type="button" onClick={() => { if (window.confirm(`Delete ${template.name}?`)) setTemplates(templates.filter((item) => item.id !== template.id)); }} aria-label={`Delete ${template.name}`} data-testid={`button-delete-template-${template.id}`} className="rounded-lg p-2 text-muted-foreground hover:text-[#ef927e]"><Trash2 size={14} /></button></div></div>)}</div></section>
        <section className="rounded-2xl border border-accent/20 bg-accent/[.06] p-5 sm:p-6"><div className="flex items-start gap-3"><Sparkles size={19} className="mt-0.5 shrink-0 text-accent" /><div><h2 className="font-display text-lg font-bold">A useful first setup</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">The starter rhythm is 14 work / 14 home, beginning today. Days are intentionally blank so your real schedule can take shape.</p></div></div><button type="button" onClick={() => { setDraft(initialConfig); setConfig(initialConfig); setOverrides([]); }} data-testid="button-reset-starter" className="mt-4 flex items-center gap-2 text-xs font-bold text-accent hover:underline"><RotateCcw size={14} />Reset to starter setup</button></section>
      </div>
    </div>
    {overrideOpen && <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#080b10]/75 p-3 backdrop-blur-sm sm:items-center"><form onSubmit={addOverride} className="modal-panel w-full max-w-md rounded-[1.5rem] border border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Manual exception</p><h2 className="mt-2 font-display text-2xl font-bold">Change the rhythm</h2></div><button type="button" onClick={() => setOverrideOpen(false)} aria-label="Close override dialog" data-testid="button-close-override-dialog" className="rounded-full p-2 text-muted-foreground hover:bg-white/[.08]"><X size={18} /></button></div><label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Label</span><input required value={overrideDraft.label} onChange={(e) => setOverrideDraft({ ...overrideDraft, label: e.target.value })} placeholder="e.g. Training week" data-testid="input-override-label" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><div className="mb-4 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">From</span><input type="date" value={overrideDraft.startDate} onChange={(e) => setOverrideDraft({ ...overrideDraft, startDate: e.target.value })} data-testid="input-override-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70" /></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Through</span><input type="date" value={overrideDraft.endDate} onChange={(e) => setOverrideDraft({ ...overrideDraft, endDate: e.target.value })} data-testid="input-override-end" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70" /></label></div><label className="mb-7 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Adjustment</span><select value={overrideDraft.adjustment} onChange={(e) => setOverrideDraft({ ...overrideDraft, adjustment: e.target.value as Adjustment })} data-testid="select-override-adjustment" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70"><option value="flip">Flip phase</option><option value="work">Set as work</option><option value="home">Set as home</option><option value="transition">Mark transition</option></select></label><button type="submit" data-testid="button-save-override" className="w-full rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground hover:brightness-110">Save override</button></form></div>}
  </div></AppShell>;
}

function Router() {
  const [config, setConfigState] = useState<HitchConfig>(() => normalizeConfig(readStore<Partial<HitchConfig>>('config', {})));
  const [blocks, setBlocksState] = useState<Block[]>(() => readStore('blocks', emptyState.blocks));
  const [overrides, setOverridesState] = useState<HitchOverride[]>(() => readStore('overrides', emptyState.overrides));
  const [daySettings, setDaySettingsState] = useState<Record<string, DaySettings>>(() => readStore('daySettings', emptyState.daySettings));
  const [templates, setTemplatesState] = useState<Template[]>(() => readStore('templates', emptyState.templates));
  const setConfig = (next: HitchConfig) => { setConfigState(next); persist('config', next); };
  const setBlocks = (next: Block[]) => { setBlocksState(next); persist('blocks', next); };
  const setOverrides = (next: HitchOverride[]) => { setOverridesState(next); persist('overrides', next); };
  const setDaySettings = (next: Record<string, DaySettings>) => { setDaySettingsState(next); persist('daySettings', next); };
  const setTemplates = (next: Template[]) => { setTemplatesState(next); persist('templates', next); };
  const addBlock = (date: string, data: Omit<Block, 'id' | 'date'>) => setBlocks([...blocks, { ...data, id: uid(), date }]);
  const updateBlock = (id: string, data: Omit<Block, 'id' | 'date'>) => setBlocks(blocks.map((block) => block.id === id ? { ...block, ...data } : block));
  const deleteBlock = (id: string) => setBlocks(blocks.filter((block) => block.id !== id));
  const [, navigate] = useLocation();
  const goToDate = (date: string) => navigate(`/?date=${date}`);
  return <Switch>
    <Route path="/"><TodayPage config={config} blocks={blocks} overrides={overrides} daySettings={daySettings} onCreateBlock={addBlock} onUpdateBlock={updateBlock} onDeleteBlock={deleteBlock} onSetDaySettings={(date, settings) => setDaySettings({ ...daySettings, [date]: settings })} /></Route>
    <Route path="/calendar"><CalendarPage config={config} blocks={blocks} overrides={overrides} /></Route>
    <Route path="/hitch"><HitchPage config={config} blocks={blocks} overrides={overrides} /></Route>
    <Route path="/settings"><SettingsPage config={config} setConfig={setConfig} overrides={overrides} setOverrides={setOverrides} daySettings={daySettings} setDaySettings={setDaySettings} templates={templates} setTemplates={setTemplates} blocks={blocks} setBlocks={setBlocks} /></Route>
    <Route component={NotFound} />
  </Switch>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const queryClient = new QueryClient();
function App() {
  useEffect(() => { document.documentElement.classList.add('dark'); }, []);
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;