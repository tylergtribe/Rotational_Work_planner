import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowDownToLine,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Home as HomeIcon,
  Layers3,
  Menu,
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
import { Link, Route, Switch, Router as WouterRouter, useLocation, useSearch } from 'wouter';
import NotFound from '@/pages/not-found';

type Mode = 'work' | 'home' | 'transition';
type TransitionDirection = 'go-home' | 'start-work';
type Adjustment = Mode | 'flip';
type BlockColor = '#534AB7' | '#0F6E56' | '#D85A30' | '#993556' | '#185FA5' | '#3B6D11' | '#854F0B' | '#A32D2D' | '#5F5E5A';
type BlockContent = { startTime: string; endTime: string; title: string; color: BlockColor };
type Block = BlockContent & { id: string; date: string; templateId?: string; templateIndex?: number; occurrenceKey?: string };
type HitchConfig = { cycleStartDate: string; workPhaseLength: number; homePhaseLength: number; defaultNightShift: boolean; goHomeTransitionHour: number; startWorkTransitionHour: number };
type HitchOverride = { id: string; startDate: string; endDate: string; label: string; adjustment: Adjustment };
type DaySettings = { transitionHour?: number; nightShiftOverride: boolean | null };
type TemplateCadence = 'one-time' | 'daily' | 'weekly' | 'biweekly';
type TemplateException = { action: 'delete' | 'update'; data?: BlockContent };
type BlockSaveOptions = { cadence: TemplateCadence; startDate: string; saveAsTemplate: boolean };
type Template = {
  id: string;
  name: string;
  blocks: BlockContent[];
  kind?: 'day' | 'block';
  cadence?: TemplateCadence;
  startDate?: string;
  enabled?: boolean;
  exceptions?: Record<string, TemplateException>;
};

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
const HOUR_PX = 60;
type LaidOutBlock = { block: Block; start: number; end: number; col: number; cols: number };
function layoutBlocks(blocks: Block[]): LaidOutBlock[] {
  const items: LaidOutBlock[] = blocks
    .map((block) => { const start = minutes(block.startTime); let end = minutes(block.endTime); if (end <= start) end = 1440; return { block, start, end: Math.min(1440, Math.max(start + 5, end)), col: 0, cols: 1 }; })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster: LaidOutBlock[] = [];
  let clusterEnd = -1;
  const flush = () => { if (!cluster.length) return; const cols = Math.max(...cluster.map((i) => i.col)) + 1; cluster.forEach((i) => { i.cols = cols; }); cluster = []; };
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) flush();
    const taken = new Set(cluster.filter((i) => i.end > item.start).map((i) => i.col));
    let col = 0;
    while (taken.has(col)) col += 1;
    item.col = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return items;
}
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
const normalizeTemplate = (value: Partial<Template>): Template => ({
  id: String(value.id ?? uid()),
  name: String(value.name ?? 'Untitled template'),
  blocks: Array.isArray(value.blocks) ? value.blocks.map((block) => ({
    startTime: String(block.startTime ?? '08:00'),
    endTime: String(block.endTime ?? '09:00'),
    title: String(block.title ?? ''),
    color: (block.color ?? '#D85A30') as BlockColor,
  })) : [],
  kind: value.kind === 'block' ? 'block' : 'day',
  cadence: value.cadence === 'daily' || value.cadence === 'weekly' || value.cadence === 'biweekly' ? value.cadence : 'one-time',
  startDate: value.startDate || todayString(),
  enabled: value.enabled !== false,
  exceptions: value.exceptions ?? {},
});
const generatedOccurrenceId = (templateId: string, date: string, index: number) => `template:${templateId}:${date}:${index}`;
const parseGeneratedOccurrence = (id: string) => {
  const parts = id.split(':');
  if (parts.length !== 4 || parts[0] !== 'template' || !parts[1] || !parts[2] || !Number.isInteger(Number(parts[3]))) return null;
  return { templateId: parts[1], date: parts[2], index: Number(parts[3]), occurrenceKey: `${parts[2]}:${parts[3]}` };
};

function templateAppliesOn(date: string, template: Template, config: HitchConfig, overrides: HitchOverride[]) {
  const cadence = template.cadence ?? 'one-time';
  if (!template.enabled || cadence === 'one-time' || !template.startDate || date < template.startDate || resolveMode(date, config, overrides) !== 'work') return false;
  const daysSinceStart = diffDays(template.startDate, date);
  const interval = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : 1;
  return cadence === 'daily' || (daysSinceStart >= 0 && daysSinceStart % interval === 0);
}

const cadenceRank = (cadence?: TemplateCadence) => cadence === 'biweekly' ? 3 : cadence === 'weekly' ? 2 : cadence === 'daily' ? 1 : 0;

function winningDayTemplate(date: string, templates: Template[], config: HitchConfig, overrides: HitchOverride[]) {
  return templates
    .filter((template) => template.kind !== 'block' && templateAppliesOn(date, template, config, overrides))
    .reduce<Template | null>((best, template) => !best || cadenceRank(template.cadence) >= cadenceRank(best.cadence) ? template : best, null);
}

function templateOccurrences(date: string, templates: Template[], config: HitchConfig, overrides: HitchOverride[]) {
  const eligible = templates.filter((template) => templateAppliesOn(date, template, config, overrides));
  const winner = winningDayTemplate(date, templates, config, overrides);
  const active = eligible.filter((template) => template.kind === 'block' || template === winner);
  return active.flatMap((template) => template.blocks.map((content, index) => ({ template, content, index })));
}

function blocksForDate(date: string, blocks: Block[], templates: Template[], config: HitchConfig, overrides: HitchOverride[]): Block[] {
  const stored = blocks.filter((block) => block.date === date);
  const claimed = new Set(stored.filter((block) => block.templateId && block.templateIndex !== undefined).map((block) => `${block.templateId}:${block.templateIndex}`));
  const seen = new Set<string>();
  const generated = templateOccurrences(date, templates, config, overrides).flatMap(({ template, content, index }) => {
    if (claimed.has(`${template.id}:${index}`)) return [];
    const occurrenceKey = `${date}:${index}`;
    const exception = template.exceptions?.[occurrenceKey];
    if (exception?.action === 'delete') return [];
    const data = exception?.action === 'update' && exception.data ? exception.data : content;
    const signature = `${data.startTime}|${data.endTime}|${data.title}|${data.color}`;
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [{ ...data, id: generatedOccurrenceId(template.id, date, index), date, templateId: template.id, occurrenceKey }];
  });
  return [...stored, ...generated].sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
}

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
        <main className="min-w-0 flex-1 pb-10">
          <header className="flex items-center justify-between px-5 py-5 md:px-10 md:py-7">
            <div className="flex items-center gap-2 md:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ArrowDownToLine size={16} /></span>
              <span className="font-display font-bold">Hitch<span className="text-primary">.</span></span>
              <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Open navigation menu" data-testid="button-mobile-navigation" className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[.1] text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><Menu size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="start" className="z-[70] w-44 border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-1.5 text-foreground shadow-2xl backdrop-blur-xl">{nav.map(({ href, label, icon: Icon }) => <DropdownMenuItem key={href} asChild className="focus:bg-white/[.08] focus:text-foreground"><Link href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className="flex w-full items-center gap-2.5 text-xs no-underline"><Icon size={15} className="text-primary" />{label}</Link></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-secondary" /><span>Saved</span></div>
          </header>
          <div className="px-5 md:px-10">{children}</div>
        </main>
      </div>
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

function BlockModal({ block, date, templates, onClose, onSave, onDelete, onEditTemplate }: { block?: Block; date: string; templates: Template[]; onClose: () => void; onSave: (data: BlockContent, options: { cadence: TemplateCadence; startDate: string; saveAsTemplate: boolean }) => void; onDelete?: () => void; onEditTemplate: (template: Template, trigger: HTMLButtonElement) => void }) {
  const [title, setTitle] = useState(block?.title ?? '');
  const [startTime, setStartTime] = useState(block?.startTime ?? '08:00');
  const [endTime, setEndTime] = useState(block?.endTime ?? '09:00');
  const [color, setColor] = useState<BlockColor>(block?.color ?? '#D85A30');
  const [cadence, setCadence] = useState<TemplateCadence>('one-time');
  const [startDate, setStartDate] = useState(date);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [blockTemplatesOpen, setBlockTemplatesOpen] = useState(false);
  const blockTemplatesTriggerRef = useRef<HTMLButtonElement>(null);
  const chooseTemplate = (template: Template) => {
    const content = template.blocks[0];
    if (!content) return;
    setTitle(content.title); setStartTime(content.startTime); setEndTime(content.endTime); setColor(content.color);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim()) onSave({ title: title.trim(), startTime, endTime, color }, { cadence, startDate, saveAsTemplate: saveAsTemplate || cadence !== 'one-time' }); };
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#080b10]/75 p-3 backdrop-blur-sm sm:items-center">
    <form onSubmit={submit} className="modal-panel w-full max-w-md rounded-[1.5rem] border border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7" data-testid="form-block-modal">
      <div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">{block ? 'Edit block' : 'New block'}</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]">{formatShortDate(date)}</h2></div><div className="flex items-center gap-1">{!block && <DropdownMenu open={blockTemplatesOpen} onOpenChange={setBlockTemplatesOpen}><DropdownMenuTrigger asChild><button ref={blockTemplatesTriggerRef} type="button" aria-label="Choose a saved block template" data-testid="button-block-template-menu" className="flex h-9 items-center gap-1 rounded-lg border border-white/[.12] px-2.5 text-[10px] font-bold text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><span>Saved blocks</span><ChevronDown size={13} /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="z-[70] max-h-64 w-64 overflow-y-auto border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-1.5 text-foreground shadow-2xl data-[state=closed]:hidden" data-testid="block-template-menu"><DropdownMenuLabel className="font-mono-app text-[9px] uppercase tracking-[.13em] text-muted-foreground">Saved block templates</DropdownMenuLabel>{templates.length === 0 ? <DropdownMenuItem disabled className="text-xs">No saved blocks yet</DropdownMenuItem> : templates.map((template) => <div key={template.id} className="flex items-center gap-1"><DropdownMenuItem onSelect={() => chooseTemplate(template)} data-testid={`button-use-block-template-${template.id}`} className="min-w-0 flex-1 justify-between text-xs focus:bg-white/[.08] focus:text-foreground"><span className="truncate">{template.name}</span><span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{template.cadence === 'weekly' ? 'Weekly' : template.cadence === 'biweekly' ? 'Every 2 weeks' : template.cadence === 'daily' ? 'Daily' : 'Saved'}</span></DropdownMenuItem><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); const trigger = blockTemplatesTriggerRef.current; if (!trigger) return; setBlockTemplatesOpen(false); window.setTimeout(() => onEditTemplate(template, trigger), 0); }} aria-label={`Edit ${template.name}`} data-testid={`button-edit-block-template-${template.id}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><Pencil size={12} /></button></div>)}</DropdownMenuContent></DropdownMenu>}<button type="button" onClick={onClose} aria-label="Close block dialog" data-testid="button-close-block-dialog" className="rounded-full p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><X size={18} /></button></div></div>
       <label className="mb-5 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">What needs your attention?</span><input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Toolbox talk" data-testid="input-block-title" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3.5 py-3 text-sm outline-none transition placeholder:text-muted-foreground/50 focus:border-primary/70 focus:ring-2 focus:ring-primary/15" /></label>
      <div className="mb-5 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Starts</span><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} data-testid="input-block-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Ends</span><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} data-testid="input-block-end" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label></div>
      {!block && <div className="mb-5 rounded-xl border border-white/[.1] bg-white/[.03] p-3"><div className="grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Repeat</span><select value={cadence} onChange={(event) => { const next = event.target.value as TemplateCadence; setCadence(next); if (next !== 'one-time') setSaveAsTemplate(true); }} data-testid="select-block-cadence" className="w-full rounded-lg border border-white/[.12] bg-black/[.16] px-2.5 py-2.5 text-xs outline-none focus:border-primary/70"><option value="one-time">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option></select></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Starts repeating</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="input-block-repeat-start" className="w-full rounded-lg border border-white/[.12] bg-black/[.16] px-2 py-2.5 text-xs outline-none focus:border-primary/70" /></label></div><label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={saveAsTemplate} onChange={(event) => setSaveAsTemplate(event.target.checked)} data-testid="checkbox-save-block-template" className="h-4 w-4 accent-[hsl(var(--primary))]" /><span>Save this block to Saved blocks</span></label></div>}
      <div className="mb-7"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Color marker</span><div className="flex flex-wrap gap-2">{colors.map((item) => <button type="button" key={item.value} aria-label={`Use ${item.label} color`} onClick={() => setColor(item.value)} data-testid={`button-color-${item.label.toLowerCase()}`} className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${color === item.value ? 'border-foreground ring-2 ring-foreground/20' : 'border-transparent'}`} style={{ backgroundColor: item.value }} />)}</div></div>
      <div className="flex items-center justify-between gap-3">{onDelete && <button type="button" onClick={() => { if (window.confirm('Delete this block from the day?')) onDelete(); }} data-testid="button-delete-block" className="flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold text-[#ee8f7e] hover:bg-primary/10"><Trash2 size={15} />Delete</button>}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} data-testid="button-cancel-block" className="rounded-xl px-4 py-3 text-xs font-semibold text-muted-foreground hover:bg-white/[.06]">Cancel</button><button type="submit" data-testid="button-save-block" className="flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground transition hover:brightness-110"><Check size={15} />{block ? 'Save changes' : 'Add to day'}</button></div></div>
    </form>
  </div>;
}

function Timeline({ date, blocks, templates, config, overrides, daySettings, mode, onAdd, onEdit, onUseTemplate, onEditTemplate, onSaveTemplate }: { date: string; blocks: Block[]; templates: Template[]; config: HitchConfig; overrides: HitchOverride[]; daySettings?: DaySettings; mode: Mode; onAdd: () => void; onEdit: (block: Block) => void; onUseTemplate: (template: Template) => void; onEditTemplate: (template: Template, trigger: HTMLButtonElement) => void; onSaveTemplate: () => void }) {
  const nightShift = daySettings?.nightShiftOverride ?? config.defaultNightShift;
  const direction = mode === 'transition' ? getTransitionDirection(date, config, overrides) : null;
  const transitionHour = transitionHourFor(date, config, overrides, daySettings);
  const timelineStyle = mode === 'transition' ? { '--transition-position': `${(transitionHour / 24) * 100}%` } as CSSProperties : undefined;
  const timelineClass = mode === 'work' ? 'timeline-day-work' : mode === 'home' ? 'timeline-day-home' : `timeline-day-transition ${direction === 'start-work' ? 'timeline-day-transition-start' : ''}`;
  const hours = Array.from({ length: 9 }, (_, i) => i * 3);
  return <section className="mt-7 overflow-hidden rounded-2xl border border-white/[.1] bg-black/[.14]">
     <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-4 py-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-accent" /><span>24-hour view</span>{nightShift && <span className="rounded-full bg-accent/10 px-2 py-1 font-mono-app text-[9px] uppercase tracking-[.1em] text-[#efc166]">Night shift · noon to noon</span>}</div><div className="flex flex-wrap items-center gap-2"><TemplatePicker templates={templates} onUse={onUseTemplate} onEdit={onEditTemplate} onSave={onSaveTemplate} /><button type="button" onClick={onAdd} data-testid="button-add-block" className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition hover:brightness-110"><Plus size={15} />Add block</button></div></div>
    <div className={`relative flex min-h-[1480px] px-3 py-5 sm:px-5 ${timelineClass}`} style={timelineStyle}>
      <div className="w-14 shrink-0 sm:w-20">{hours.map((hour) => <div key={hour} className="h-[180px] -translate-y-2 font-mono-app text-[10px] text-muted-foreground">{hour === 0 || hour === 24 ? '12 AM' : hour === 12 ? '12 PM' : `${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`}</div>)}</div>
      <div className="timeline-grid relative h-[1440px] flex-1 border-l border-white/[.1]">
        {nightShift && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1/2 bg-accent/[.025]" />}
        {blocks.length === 0 && <div className="absolute inset-x-4 top-[25%] text-center"><div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[.1] bg-white/[.04] text-muted-foreground"><Sun size={19} /></div><p className="font-display text-sm font-semibold">A clear run ahead</p><button type="button" onClick={onAdd} data-testid="button-add-first-block" className="mt-4 text-xs font-bold text-primary hover:underline">Add your first block</button></div>}
        {layoutBlocks(blocks).map(({ block, start, end, col, cols }) => {
          const duration = end - start;
          const compact = duration < 26;
          const showTime = duration >= 44;
          return <button type="button" key={block.id} onClick={() => onEdit(block)} data-testid={`card-block-${block.id}`} className={`event-card absolute z-10 overflow-hidden rounded-xl border border-white/20 text-left shadow-lg ${compact ? 'px-2 py-0' : 'px-3 py-1.5'}`} style={{ top: `${start}px`, height: `${Math.max(13, duration - 2)}px`, left: `calc(0.75rem + (100% - 1.5rem) * ${col / cols})`, width: `calc((100% - 1.5rem) / ${cols} - 3px)`, backgroundColor: `${block.color}dd`, borderLeft: `4px solid ${block.color}` }}>
            <span className={`block truncate font-bold leading-tight text-white ${compact ? 'text-[10px]' : 'text-sm'}`}>{block.title}</span>{showTime && <span className="mt-0.5 block truncate font-mono-app text-[10px] text-white/75">{timeLabel(block.startTime)} — {timeLabel(block.endTime)}</span>}
          </button>;
        })}
      </div>
    </div>
  </section>;
}

function TemplateSaveModal({ date, dayBlocks, dayTemplates, onClose, onSave }: { date: string; dayBlocks: Block[]; dayTemplates: Template[]; onClose: () => void; onSave: (name: string, cadence: TemplateCadence, startDate: string, targetId: string | undefined, selectedIds: string[]) => void }) {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<TemplateCadence>('one-time');
  const [startDate, setStartDate] = useState(date);
  const [targetId, setTargetId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(() => dayBlocks.map((block) => block.id));
  const blockCount = selectedIds.length;
  const toggleBlock = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const chooseTarget = (id: string) => {
    setTargetId(id);
    const existing = dayTemplates.find((item) => item.id === id);
    if (!existing) { setName(''); setCadence('one-time'); setStartDate(date); return; }
    setName(existing.name);
    setCadence(existing.cadence ?? 'one-time');
    setStartDate(existing.startDate ?? date);
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim() && blockCount > 0) onSave(name.trim(), cadence, startDate, targetId || undefined, selectedIds); };
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#080b10]/75 p-3 backdrop-blur-sm sm:items-center"><form onSubmit={submit} data-testid="form-save-day-template" className="modal-panel w-full max-w-md rounded-[1.5rem] border border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Save this day</p><h2 className="mt-2 font-display text-2xl font-bold">Create a template</h2><p className="mt-2 text-xs text-muted-foreground">{blockCount} of {dayBlocks.length} {dayBlocks.length === 1 ? 'block' : 'blocks'} from {formatShortDate(date)}</p></div><button type="button" onClick={onClose} aria-label="Close template dialog" data-testid="button-close-template-dialog" className="rounded-full p-2 text-muted-foreground hover:bg-white/[.08]"><X size={18} /></button></div>{dayTemplates.length > 0 && <label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Save as</span><select value={targetId} onChange={(event) => chooseTarget(event.target.value)} data-testid="select-template-target" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-xs outline-none focus:border-primary/70"><option value="">Create a new template</option>{dayTemplates.map((item) => <option key={item.id} value={item.id}>Update “{item.name}”</option>)}</select></label>}<label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Template name</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Normal work day" data-testid="input-template-name" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><div className="mb-4"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Include in template</span><div className="max-h-44 overflow-y-auto rounded-xl border border-white/[.12] bg-black/[.16] p-1">{dayBlocks.map((block) => { const on = selectedIds.includes(block.id); return <button type="button" key={block.id} onClick={() => toggleBlock(block.id)} data-testid={`toggle-template-block-${block.id}`} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/[.06]"><span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-transparent bg-primary text-primary-foreground' : 'border-white/25'}`}>{on && <Check size={11} />}</span><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: block.color }} /><span className={`min-w-0 flex-1 truncate text-xs ${on ? '' : 'text-muted-foreground line-through'}`}>{block.title}</span><span className="shrink-0 font-mono-app text-[9px] text-muted-foreground">{timeLabel(block.startTime)}</span></button>; })}</div><p className="mt-2 text-[10px] text-muted-foreground">Uncheck one-off appointments so they stay on this day only.</p></div><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Repeat</span><select value={cadence} onChange={(event) => setCadence(event.target.value as TemplateCadence)} data-testid="select-template-cadence" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-xs outline-none focus:border-primary/70"><option value="one-time">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option></select></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="input-template-start-date" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-xs outline-none focus:border-primary/70" /></label></div><button type="submit" disabled={blockCount === 0} data-testid="button-save-template" className="mt-6 w-full rounded-xl bg-secondary px-4 py-3 text-xs font-bold text-secondary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Save day template</button>{blockCount === 0 && <p className="mt-3 text-center text-[11px] text-muted-foreground">Add a block to this day first.</p>}</form></div>;
}

function TemplateEditModal({ template, returnFocus, onClose, onSave, onDelete }: { template: Template; returnFocus?: HTMLButtonElement | null; onClose: () => void; onSave: (changes: { name: string; cadence: TemplateCadence; startDate: string; enabled: boolean }) => void; onDelete: () => void }) {
  const [name, setName] = useState(template.name);
  const [cadence, setCadence] = useState<TemplateCadence>(template.cadence ?? 'one-time');
  const [startDate, setStartDate] = useState(template.startDate ?? todayString());
  const [enabled, setEnabled] = useState(template.enabled !== false);
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), cadence, startDate, enabled }); };
  const kindLabel = template.kind === 'block' ? 'Saved block' : 'Saved day';
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); window.setTimeout(() => returnFocus?.focus(), 0); }} className="modal-panel w-[calc(100%-1.5rem)] max-w-md rounded-[1.5rem] border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7"><form onSubmit={submit} data-testid="form-edit-template"><div className="mb-6"><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">{kindLabel}</p><DialogTitle className="mt-2 font-display text-2xl font-bold">Edit template</DialogTitle><DialogDescription className="mt-2 text-xs text-muted-foreground">{template.blocks.length} {template.kind === 'block' ? 'block' : 'blocks'} · Change its name or repeat settings.</DialogDescription></div><label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Template name</span><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} data-testid="input-edit-template-name" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><div className="mb-4 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Repeat</span><select value={cadence} onChange={(event) => setCadence(event.target.value as TemplateCadence)} data-testid="select-edit-template-cadence" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70"><option value="one-time">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option></select></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="input-edit-template-start-date" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70" /></label></div><button type="button" onClick={() => setEnabled(!enabled)} data-testid="button-toggle-edit-template" className="mb-6 flex w-full items-center justify-between rounded-xl border border-white/[.1] bg-white/[.035] px-3 py-3 text-left text-xs"><span>Template status</span><span className={enabled ? 'font-bold text-accent' : 'text-muted-foreground'}>{enabled ? 'Active' : 'Disabled'}</span></button><div className="flex gap-2"><button type="button" onClick={() => { if (window.confirm(`Remove ${template.name}?`)) onDelete(); }} data-testid="button-remove-template" className="rounded-xl border border-primary/30 px-4 py-3 text-xs font-bold text-[#ef927e] hover:bg-primary/10">Remove</button><button type="submit" data-testid="button-save-template-edits" className="flex-1 rounded-xl bg-secondary px-4 py-3 text-xs font-bold text-secondary-foreground hover:brightness-110">Save changes</button></div></form></DialogContent></Dialog>;
}

function TemplatePicker({ templates, onUse, onEdit, onSave }: { templates: Template[]; onUse: (template: Template) => void; onEdit: (template: Template, trigger: HTMLButtonElement) => void; onSave: () => void }) {
  const [selectedId, setSelectedId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (selectedId && !templates.some((template) => template.id === selectedId)) setSelectedId(''); }, [templates, selectedId]);
  const selected = templates.find((template) => template.id === selectedId);
  const cadenceLabel = (cadence: TemplateCadence = 'one-time') => cadence === 'daily' ? 'Daily' : cadence === 'weekly' ? 'Weekly' : cadence === 'biweekly' ? 'Every 2 weeks' : 'One-time';
  return <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}><DropdownMenuTrigger asChild><button ref={menuTriggerRef} type="button" data-testid="button-day-templates" className="flex h-8 max-w-[190px] items-center gap-1.5 rounded-lg border border-white/[.12] bg-black/[.16] px-2.5 text-[10px] font-bold text-muted-foreground hover:bg-white/[.07] hover:text-foreground"><Copy size={13} /><span className="truncate">{selected?.name ?? 'Day templates'}</span><ChevronDown size={12} className="shrink-0" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="z-[60] max-h-72 w-72 overflow-y-auto border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-1.5 text-foreground shadow-2xl data-[state=closed]:hidden" data-testid="day-template-menu"><DropdownMenuLabel className="font-mono-app text-[9px] uppercase tracking-[.13em] text-muted-foreground">Day templates</DropdownMenuLabel>{templates.length === 0 ? <DropdownMenuItem disabled className="text-xs">No saved day templates yet</DropdownMenuItem> : templates.map((template) => <div key={template.id} className="flex items-center gap-1"><DropdownMenuItem onSelect={(event) => { event.preventDefault(); setSelectedId(template.id); }} data-testid={`button-select-day-template-${template.id}`} className="min-w-0 flex-1 items-center gap-2 text-xs focus:bg-white/[.08] focus:text-foreground"><span className="flex h-4 w-4 shrink-0 items-center justify-center">{selectedId === template.id && <Check size={12} className="text-accent" />}</span><span className="min-w-0 flex-1 truncate">{template.name}</span><span className="shrink-0 text-[9px] text-muted-foreground">{cadenceLabel(template.cadence)}</span></DropdownMenuItem><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); const trigger = menuTriggerRef.current; if (!trigger) return; setMenuOpen(false); window.setTimeout(() => onEdit(template, trigger), 0); }} aria-label={`Edit ${template.name}`} data-testid={`button-edit-day-template-${template.id}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><Pencil size={12} /></button></div>)}<div className="mt-1 border-t border-white/[.08] pt-1"><button type="button" disabled={!selected} onClick={() => { if (selected) { setMenuOpen(false); onUse(selected); } }} data-testid="button-use-day-template" className="w-full rounded-lg bg-secondary px-3 py-2 text-left text-[10px] font-bold text-secondary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Check size={13} className="mr-1.5 inline" />Use selected template</button><button type="button" onClick={() => { setMenuOpen(false); onSave(); }} data-testid="button-save-day-template" className="mt-1 w-full rounded-lg border border-white/[.1] px-3 py-2 text-left text-[10px] font-bold text-muted-foreground hover:bg-white/[.07] hover:text-foreground"><Copy size={13} className="mr-1.5 inline" />Save current day as template</button></div></DropdownMenuContent></DropdownMenu>;
}

function TodayPage({ config, blocks, templates, overrides, daySettings, onCreateBlock, onUpdateBlock, onDeleteBlock, onSetDaySettings, onSaveTemplate, onUseTemplate, onUpdateTemplate, onDeleteTemplate }: { config: HitchConfig; blocks: Block[]; templates: Template[]; overrides: HitchOverride[]; daySettings: Record<string, DaySettings>; onCreateBlock: (date: string, data: BlockContent, options: BlockSaveOptions) => void; onUpdateBlock: (id: string, data: BlockContent) => void; onDeleteBlock: (id: string) => void; onSetDaySettings: (date: string, settings: DaySettings) => void; onSaveTemplate: (date: string, name: string, cadence: TemplateCadence, startDate: string, targetId?: string, selectedIds?: string[]) => void; onUseTemplate: (date: string, template: Template) => void; onUpdateTemplate: (id: string, changes: { name: string; cadence: TemplateCadence; startDate: string; enabled: boolean }) => void; onDeleteTemplate: (id: string) => void }) {
  const [location] = useLocation(); const search = useSearch(); const queryDate = new URLSearchParams(search).get('date'); const [date, setDate] = useState(queryDate ?? todayString()); const [editing, setEditing] = useState<Block>(); const [editingTemplate, setEditingTemplate] = useState<Template>(); const [templateEditorTrigger, setTemplateEditorTrigger] = useState<HTMLButtonElement | null>(null);
  const [adding, setAdding] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [savingTemplate, setSavingTemplate] = useState(false);
   const mode = resolveMode(date, config, overrides); const dateBlocks = blocksForDate(date, blocks, templates, config, overrides); const dayTemplates = templates.filter((template) => template.kind !== 'block'); const blockTemplates = templates.filter((template) => template.kind === 'block');
  const settings = daySettings[date]; const isToday = date === todayString(); const nightShift = settings?.nightShiftOverride ?? config.defaultNightShift;
  useEffect(() => { setDate(queryDate ?? todayString()); }, [location, queryDate, search]);
  return <AppShell mode={mode}><div className="fade-in mx-auto max-w-[1040px]">
    <div className="flex flex-col justify-between gap-5 border-b border-white/[.09] pb-7 sm:flex-row sm:items-end"><div><div className="mb-4 flex items-center gap-3"><PhaseBadge mode={mode} />{isToday && <span className="font-mono-app text-[10px] uppercase tracking-[.15em] text-muted-foreground">Live date</span>}</div><h1 data-testid="text-today-date" className="font-display text-[clamp(2.2rem,7vw,4.4rem)] font-bold leading-[.95] tracking-[-.07em]">{formatLongDate(date)}</h1></div><div className="flex items-center gap-2 self-end"><DatePicker date={date} onChange={setDate} /><div className="relative"><button type="button" aria-label="Open day settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} data-testid="button-open-day-settings" className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.1] bg-white/[.045] text-muted-foreground transition hover:bg-white/[.08] hover:text-foreground"><Settings size={16} /></button>{settingsOpen && <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-white/[.12] bg-[hsl(221_22%_13%/.98)] p-4 shadow-2xl backdrop-blur-xl" data-testid="day-settings-popover"><div className="mb-4 flex items-center justify-between"><span className="font-display text-sm font-bold">Day settings</span><span className="font-mono-app text-[9px] text-muted-foreground">{dateBlocks.length} {dateBlocks.length === 1 ? 'block' : 'blocks'}</span></div><label className="block"><span className="mb-2 block text-[11px] font-semibold text-muted-foreground">Transition hour</span><select value={settings?.transitionHour ?? transitionHourFor(date, config, overrides)} onChange={(event) => onSetDaySettings(date, { transitionHour: Number(event.target.value), nightShiftOverride: settings?.nightShiftOverride ?? null })} data-testid="select-transition-hour" className="w-full rounded-lg border border-white/[.1] bg-black/[.2] px-2 py-2 font-mono-app text-[10px] text-foreground outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label><button type="button" onClick={() => onSetDaySettings(date, { transitionHour: settings?.transitionHour, nightShiftOverride: !nightShift })} data-testid="button-toggle-date-night" className="mt-3 flex w-full items-center justify-between rounded-lg border border-white/[.1] bg-white/[.035] px-3 py-2.5 text-left text-xs text-muted-foreground transition hover:bg-white/[.07]"><span className="flex items-center gap-2"><Moon size={14} className={nightShift ? 'text-accent' : ''} />Night shift</span><span className={nightShift ? 'text-accent' : 'text-muted-foreground'}>{nightShift ? 'On' : 'Off'}</span></button></div>}</div></div></div>
      <Timeline date={date} blocks={dateBlocks} templates={dayTemplates} config={config} overrides={overrides} daySettings={settings} mode={mode} onAdd={() => setAdding(true)} onEdit={setEditing} onUseTemplate={(template) => onUseTemplate(date, template)} onEditTemplate={(template, trigger) => { setTemplateEditorTrigger(trigger); setEditingTemplate(template); }} onSaveTemplate={() => setSavingTemplate(true)} />
      {adding && <BlockModal date={date} templates={blockTemplates} onClose={() => setAdding(false)} onSave={(data, options) => { onCreateBlock(date, data, options); setAdding(false); }} onEditTemplate={(template, trigger) => { setTemplateEditorTrigger(trigger); setEditingTemplate(template); }} />}
      {editing && <BlockModal block={editing} date={date} templates={blockTemplates} onClose={() => setEditing(undefined)} onSave={(data) => { onUpdateBlock(editing.id, data); setEditing(undefined); }} onDelete={() => { onDeleteBlock(editing.id); setEditing(undefined); }} onEditTemplate={(template, trigger) => { setTemplateEditorTrigger(trigger); setEditingTemplate(template); }} />}
     {savingTemplate && <TemplateSaveModal date={date} dayBlocks={dateBlocks} dayTemplates={dayTemplates} onClose={() => setSavingTemplate(false)} onSave={(name, cadence, startDate, targetId, selectedIds) => { onSaveTemplate(date, name, cadence, startDate, targetId, selectedIds); setSavingTemplate(false); }} />}
      {editingTemplate && <TemplateEditModal template={editingTemplate} returnFocus={templateEditorTrigger} onClose={() => setEditingTemplate(undefined)} onSave={(changes) => { onUpdateTemplate(editingTemplate.id, changes); setEditingTemplate(undefined); }} onDelete={() => { onDeleteTemplate(editingTemplate.id); setEditingTemplate(undefined); }} />}
  </div></AppShell>;
}

function CalendarPage({ config, blocks, templates, overrides }: { config: HitchConfig; blocks: Block[]; templates: Template[]; overrides: HitchOverride[] }) {
  const [, navigate] = useLocation(); const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const start = new Date(month.getFullYear(), month.getMonth(), 1); const first = (start.getDay() + 6) % 7; const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((first + days) / 7) * 7 }, (_, i) => { const n = i - first + 1; return n > 0 && n <= days ? toDateString(new Date(month.getFullYear(), month.getMonth(), n)) : null; });
  const todayMode = resolveMode(todayString(), config, overrides);
  return <AppShell mode={todayMode}><div className="fade-in mx-auto max-w-[1100px]">
    <div className="flex flex-col justify-between gap-4 border-b border-white/[.09] pb-7 sm:flex-row sm:items-end"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">The wider view</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">Calendar<span className="text-primary">.</span></h1></div><div className="flex items-center gap-2"><button type="button" onClick={() => setMonth(new Date())} data-testid="button-calendar-today" className="rounded-xl border border-white/[.1] px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-white/[.06] hover:text-foreground">This month</button><div className="flex rounded-xl border border-white/[.1] bg-white/[.04] p-1"><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" data-testid="button-previous-month" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronLeft size={16} /></button><button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" data-testid="button-next-month" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.08] hover:text-foreground"><ChevronRight size={16} /></button></div></div></div>
    <div className="mt-8 flex items-center justify-between"><h2 data-testid="text-calendar-month" className="font-display text-2xl font-bold tracking-[-.04em]">{monthTitle(month)}</h2><div className="flex gap-3 font-mono-app text-[9px] uppercase tracking-[.12em] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Work</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-secondary" />Home</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-accent" />Transition</span></div></div>
     <div className="mt-4 overflow-hidden rounded-2xl border border-white/[.1] bg-black/[.12]"><div className="grid grid-cols-7 border-b border-white/[.1]">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <div key={day} className="px-2 py-3 text-center font-mono-app text-[9px] uppercase tracking-[.14em] text-muted-foreground sm:px-4 sm:text-left">{day}</div>)}</div><div className="grid grid-cols-7">{cells.map((date, index) => { const cellBlocks = date ? blocksForDate(date, blocks, templates, config, overrides) : []; const mode = date ? resolveMode(date, config, overrides) : 'home'; const direction = date && mode === 'transition' ? getTransitionDirection(date, config, overrides) : null; const today = date === todayString(); return <button type="button" disabled={!date} key={`${date}-${index}`} onClick={() => date && navigate(`/?date=${date}`)} data-testid={date ? `calendar-day-${date}` : `calendar-empty-${index}`} style={date && mode === 'transition' ? transitionStyleFor(date, config, overrides) : undefined} className={`relative min-h-[96px] border-b border-r border-white/[.07] p-2 text-left transition last:border-r-0 sm:min-h-[130px] sm:p-3 ${date ? mode === 'work' ? 'mode-cell-work hover:brightness-110' : mode === 'home' ? 'mode-cell-home hover:brightness-110' : `mode-cell-transition ${direction === 'start-work' ? 'mode-cell-transition-start' : ''} hover:brightness-110` : 'bg-white/[.012]'} ${today ? 'ring-1 ring-inset ring-foreground/80' : ''}`}>{date && <><div className="flex items-center justify-between"><span className={`font-display text-sm font-bold ${today ? 'flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground' : ''}`}>{parseDate(date).getDate()}</span>{cellBlocks.length > 0 && <span className="font-mono-app text-[9px] text-foreground/75">{cellBlocks.length}</span>}</div><div className={`absolute bottom-0 left-0 right-0 h-0.5 ${mode === 'work' ? 'bg-[#f0a38e]' : mode === 'home' ? 'bg-[#8fd8c3]' : 'bg-accent'}`} />{cellBlocks.slice(0, 2).map((block) => <div key={block.id} className="mt-2 truncate rounded-md px-1.5 py-1 text-[10px] font-semibold text-white/90" style={{ backgroundColor: `${block.color}bb` }}>{block.title}</div>)}</>}</button>; })}</div></div>
  </div></AppShell>;
}

function OverrideModal({ initialAdjustment, onClose, onSave }: { initialAdjustment: 'work' | 'home'; onClose: () => void; onSave: (item: Omit<HitchOverride, 'id'>) => void }) {
  const [draft, setDraft] = useState({ startDate: todayString(), endDate: todayString(), label: '', adjustment: initialAdjustment as Adjustment });
  const submit = (event: FormEvent) => { event.preventDefault(); if (draft.label.trim()) onSave({ ...draft, label: draft.label.trim() }); };
  return <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#080b10]/75 p-3 backdrop-blur-sm sm:items-center"><form onSubmit={submit} className="modal-panel w-full max-w-md rounded-[1.5rem] border border-white/[.12] bg-[hsl(221_22%_13%)] p-5 shadow-2xl sm:p-7"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-primary">Hitch adjustment</p><h2 className="mt-2 font-display text-2xl font-bold">Change scheduled days</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Extend Work or Home by assigning the dates you need.</p></div><button type="button" onClick={onClose} aria-label="Close override dialog" data-testid="button-close-override-dialog" className="rounded-full p-2 text-muted-foreground hover:bg-white/[.08]"><X size={18} /></button></div><label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Label</span><input required value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="e.g. Extended hitch" data-testid="input-override-label" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><div className="mb-4 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">From</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} data-testid="input-override-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70" /></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Through</span><input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} data-testid="input-override-end" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-2 py-3 text-xs outline-none focus:border-primary/70" /></label></div><label className="mb-7 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Make these dates</span><select value={draft.adjustment} onChange={(event) => setDraft({ ...draft, adjustment: event.target.value as Adjustment })} data-testid="select-override-adjustment" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70"><option value="work">Work days</option><option value="home">Home days</option><option value="transition">Transition days</option><option value="flip">Opposite of the normal schedule</option></select></label><button type="submit" data-testid="button-save-override" className="w-full rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground hover:brightness-110">Save hitch adjustment</button></form></div>;
}

function HitchPage({ config, blocks, templates, overrides, setOverrides }: { config: HitchConfig; blocks: Block[]; templates: Template[]; overrides: HitchOverride[]; setOverrides: (items: HitchOverride[]) => void }) {
  const [, navigate] = useLocation(); const total = config.workPhaseLength + config.homePhaseLength; const start = config.cycleStartDate; const today = todayString();
  const [overrideOpen, setOverrideOpen] = useState(false); const [overrideDefault, setOverrideDefault] = useState<'work' | 'home'>('work');
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
     <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-14">{days.map(({ date, index }) => { const isToday = date === today; const count = blocksForDate(date, blocks, templates, config, overrides).length; const dayMode = resolveMode(date, config, overrides); const direction = dayMode === 'transition' ? getTransitionDirection(date, config, overrides) : null; const modeClass = dayMode === 'work' ? 'mode-cell-work' : dayMode === 'home' ? 'mode-cell-home' : `mode-cell-transition ${direction === 'start-work' ? 'mode-cell-transition-start' : ''}`; return <button type="button" key={date} onClick={() => navigate(`/?date=${date}`)} data-testid={`hitch-day-${date}`} style={dayMode === 'transition' ? transitionStyleFor(date, config, overrides) : undefined} className={`group relative min-h-[92px] overflow-hidden rounded-xl border p-2 text-left transition hover:-translate-y-0.5 hover:brightness-110 ${modeClass} ${isToday ? 'border-foreground/80 ring-1 ring-foreground/80' : 'border-white/[.1]'}`}><span className="font-mono-app text-[9px] opacity-70">DAY {index + 1}</span><span className={`mt-2 block font-display text-xl font-bold ${isToday ? '' : 'opacity-90'}`}>{parseDate(date).getDate()}</span>{count > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}</button>; })}</div>
    <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${baseMode === 'work' ? 'bg-primary' : 'bg-secondary'}`} />{baseMode === 'work' ? 'Work' : 'Home'}</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-accent" />Scheduled blocks</span></div>
     <section className="mt-8 rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">Schedule changes</p><h2 className="mt-2 font-display text-xl font-bold">Adjust this hitch</h2><p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">Extend your hitch, extend Home time, or switch specific dates from Work to Home and vice versa.</p></div><CalendarRange size={20} className="text-muted-foreground" /></div><div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => { setOverrideDefault('work'); setOverrideOpen(true); }} data-testid="button-extend-work" className="rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground">Extend Work</button><button type="button" onClick={() => { setOverrideDefault('home'); setOverrideOpen(true); }} data-testid="button-extend-home" className="rounded-xl bg-secondary px-4 py-3 text-xs font-bold text-secondary-foreground">Extend Home</button></div>{overrides.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-white/[.14] p-4 text-xs text-muted-foreground">No hitch adjustments yet.</div> : <div className="mt-4 space-y-2">{overrides.map((item) => <div key={item.id} data-testid={`row-override-${item.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-black/[.12] p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.label}</p><p className="mt-1 font-mono-app text-[10px] text-muted-foreground">{formatShortDate(item.startDate)} — {formatShortDate(item.endDate)} · {item.adjustment === 'work' ? 'Work' : item.adjustment === 'home' ? 'Home' : 'Flipped'}</p></div><button type="button" onClick={() => { if (window.confirm(`Remove ${item.label}?`)) setOverrides(overrides.filter((override) => override.id !== item.id)); }} aria-label={`Remove ${item.label}`} data-testid={`button-delete-override-${item.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-[#ef927e]"><Trash2 size={15} /></button></div>)}</div>}</section>
     {overrideOpen && <OverrideModal initialAdjustment={overrideDefault} onClose={() => setOverrideOpen(false)} onSave={(item) => { setOverrides([...overrides, { ...item, id: uid() }]); setOverrideOpen(false); }} />}
  </div></AppShell>;
}

function SettingsPage({ config, setConfig, overrides, setOverrides, daySettings, setDaySettings }: { config: HitchConfig; setConfig: (config: HitchConfig) => void; overrides: HitchOverride[]; setOverrides: (items: HitchOverride[]) => void; daySettings: Record<string, DaySettings>; setDaySettings: (items: Record<string, DaySettings>) => void }) {
  const [draft, setDraft] = useState(config); const [customHomeLength, setCustomHomeLength] = useState(config.homePhaseLength !== config.workPhaseLength);
  const saveConfig = () => { const next = normalizeConfig({ ...draft, homePhaseLength: customHomeLength ? draft.homePhaseLength : draft.workPhaseLength, defaultNightShift: config.defaultNightShift }); setDraft(next); setConfig(next); };
  const toggleDayNight = () => { const date = todayString(); const current = daySettings[date]?.nightShiftOverride ?? config.defaultNightShift; setDaySettings({ ...daySettings, [date]: { transitionHour: daySettings[date]?.transitionHour, nightShiftOverride: !current } }); };
  return <AppShell mode={resolveMode(todayString(), config, overrides)}><div className="fade-in mx-auto max-w-[960px]">
    <div className="border-b border-white/[.09] pb-7"><p className="font-mono-app text-[10px] uppercase tracking-[.2em] text-muted-foreground">Tune the cockpit</p><h1 className="mt-3 font-display text-4xl font-bold tracking-[-.06em] sm:text-5xl">Settings<span className="text-primary">.</span></h1><p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">Your defaults live on this device. No account, no sync, no surprises.</p></div>
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.1fr_.9fr]">
       <div className="space-y-6">
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-6 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">01 / rhythm</p><h2 className="mt-2 font-display text-xl font-bold">Cycle configuration</h2><p className="mt-1 text-xs text-muted-foreground">Set when your hitch starts, how long you work, and when the colors change.</p></div><SlidersHorizontal size={20} className="text-muted-foreground" /></div><label className="mb-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Cycle starts</span><input type="date" value={draft.cycleStartDate} onChange={(e) => setDraft({ ...draft, cycleStartDate: e.target.value })} data-testid="input-cycle-start" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><label className="block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Hitch length</span><input type="number" min="1" max="90" value={draft.workPhaseLength} onChange={(e) => setDraft({ ...draft, workPhaseLength: Number(e.target.value), homePhaseLength: customHomeLength ? draft.homePhaseLength : Number(e.target.value) })} data-testid="input-hitch-length" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label><label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-white/[.1] bg-black/[.12] p-3"><input type="checkbox" checked={customHomeLength} onChange={(e) => { const enabled = e.target.checked; setCustomHomeLength(enabled); if (!enabled) setDraft({ ...draft, homePhaseLength: draft.workPhaseLength }); }} data-testid="checkbox-custom-home-length" className="h-4 w-4 accent-[hsl(var(--primary))]" /><span><span className="block text-xs font-semibold">Use a custom Home length</span><span className="mt-1 block text-[11px] text-muted-foreground">{customHomeLength ? 'Set Home days separately.' : `Home automatically matches your ${draft.workPhaseLength}-day hitch.`}</span></span></label>{customHomeLength && <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold text-muted-foreground">Home days</span><input type="number" min="1" max="90" value={draft.homePhaseLength} onChange={(e) => setDraft({ ...draft, homePhaseLength: Number(e.target.value) })} data-testid="input-home-length" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 text-sm outline-none focus:border-primary/70" /></label>}<div className="mt-5 grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Go Home color change</span><select value={draft.goHomeTransitionHour} onChange={(e) => setDraft({ ...draft, goHomeTransitionHour: Number(e.target.value) })} data-testid="select-go-home-transition-hour" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 font-mono-app text-xs outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label><label><span className="mb-2 block text-xs font-semibold text-muted-foreground">Start Work color change</span><select value={draft.startWorkTransitionHour} onChange={(e) => setDraft({ ...draft, startWorkTransitionHour: Number(e.target.value) })} data-testid="select-start-work-transition-hour" className="w-full rounded-xl border border-white/[.12] bg-black/[.16] px-3 py-3 font-mono-app text-xs outline-none focus:border-primary/70">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{timeLabel(`${String(hour).padStart(2, '0')}:00`)}</option>)}</select></label></div><button type="button" onClick={saveConfig} data-testid="button-save-cycle" className="mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground hover:brightness-110"><Save size={15} />Save cycle</button></section>
        <section className="rounded-2xl border border-white/[.1] bg-white/[.035] p-5 sm:p-6"><div className="mb-5 flex items-start justify-between"><div><p className="font-mono-app text-[10px] uppercase tracking-[.18em] text-primary">02 / defaults</p><h2 className="mt-2 font-display text-xl font-bold">Shift behavior</h2></div><Moon size={20} className="text-accent" /></div><button type="button" onClick={() => setConfig({ ...config, defaultNightShift: !config.defaultNightShift })} data-testid="button-toggle-night-shift" className="flex w-full items-center justify-between rounded-xl border border-white/[.1] bg-black/[.14] p-4 text-left transition hover:bg-white/[.05]"><span><span className="block text-sm font-semibold">Night-shift default</span><span className="mt-1 block text-xs text-muted-foreground">Treat noon-to-noon as the working window</span></span><span className={`relative h-6 w-11 rounded-full transition ${config.defaultNightShift ? 'bg-accent' : 'bg-white/[.16]'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-foreground transition ${config.defaultNightShift ? 'left-6' : 'left-1'}`} /></span></button><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Today’s override</span><button type="button" onClick={toggleDayNight} data-testid="button-toggle-today-night" className="font-semibold text-primary hover:underline">{daySettings[todayString()]?.nightShiftOverride ?? config.defaultNightShift ? 'Night shift on' : 'Day shift on'}</button></div></section>
      </div>
      <div className="space-y-6">
        <section className="rounded-2xl border border-accent/20 bg-accent/[.06] p-5 sm:p-6"><div className="flex items-start gap-3"><Sparkles size={19} className="mt-0.5 shrink-0 text-accent" /><div><h2 className="font-display text-lg font-bold">A useful first setup</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">The starter rhythm is a 14-day hitch with Home automatically matching it. Day templates now live on the Today screen, and schedule changes live in Hitch.</p></div></div><button type="button" onClick={() => { setDraft(initialConfig); setCustomHomeLength(false); setConfig(initialConfig); setOverrides([]); }} data-testid="button-reset-starter" className="mt-4 flex items-center gap-2 text-xs font-bold text-accent hover:underline"><RotateCcw size={14} />Reset to starter setup</button></section>
      </div>
    </div>
  </div></AppShell>;
}

function Router() {
  const [config, setConfigState] = useState<HitchConfig>(() => normalizeConfig(readStore<Partial<HitchConfig>>('config', {})));
  const [blocks, setBlocksState] = useState<Block[]>(() => readStore('blocks', emptyState.blocks));
  const [overrides, setOverridesState] = useState<HitchOverride[]>(() => readStore('overrides', emptyState.overrides));
  const [daySettings, setDaySettingsState] = useState<Record<string, DaySettings>>(() => readStore('daySettings', emptyState.daySettings));
  const [templates, setTemplatesState] = useState<Template[]>(() => {
    const stored = readStore<Partial<Template>[]>('templates', emptyState.templates);
    return Array.isArray(stored) ? stored.map(normalizeTemplate) : [];
  });
  const setConfig = (next: HitchConfig) => { setConfigState(next); persist('config', next); };
  const setBlocks = (next: Block[]) => { setBlocksState(next); persist('blocks', next); };
  const setOverrides = (next: HitchOverride[]) => { setOverridesState(next); persist('overrides', next); };
  const setDaySettings = (next: Record<string, DaySettings>) => { setDaySettingsState(next); persist('daySettings', next); };
  const setTemplates = (next: Template[]) => { setTemplatesState(next); persist('templates', next); };
  const migrated = useRef(false);
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    const untagged = blocks.filter((block) => !block.templateId);
    if (untagged.length === 0 || templates.length === 0) return;
    const byDate = new Map<string, { template: Template; content: BlockContent; index: number }[]>();
    let changed = false;
    const next = blocks.map((block) => {
      if (block.templateId) return block;
      if (!byDate.has(block.date)) byDate.set(block.date, templateOccurrences(block.date, templates, config, overrides));
      const pool = byDate.get(block.date)!;
      const match = pool.findIndex(({ content }) => content.startTime === block.startTime && content.endTime === block.endTime && content.title === block.title && content.color === block.color);
      if (match === -1) return block;
      const { template, index } = pool[match];
      pool.splice(match, 1);
      changed = true;
      return { ...block, templateId: template.id, templateIndex: index };
    });
    if (changed) setBlocks(next);
  }, []);
  const saveDayTemplate = (date: string, name: string, cadence: TemplateCadence, startDate: string, targetId?: string, selectedIds?: string[]) => {
    const dayBlocks = blocksForDate(date, blocks, templates, config, overrides);
    const chosen = selectedIds ? dayBlocks.filter((block) => selectedIds.includes(block.id)) : dayBlocks;
    const source = chosen.map(({ startTime, endTime, title, color }) => ({ startTime, endTime, title, color }));
    if (source.length === 0) return;
    const absorbed = new Set(chosen
      .filter((block) => block.templateId && templates.some((item) => item.id === block.templateId && item.kind === 'block'))
      .map((block) => block.templateId!));
    const templateId = targetId ?? uid();
    const template: Template = { id: templateId, name, blocks: source, kind: 'day', cadence, startDate: startDate || date, enabled: true, exceptions: {} };
    const withAbsorbed = templates.map((item) => absorbed.has(item.id) ? { ...item, enabled: false } : item);
    const nextTemplates = targetId
      ? withAbsorbed.map((item) => item.id === targetId ? template : item)
      : [...withAbsorbed, template];
    setTemplates(nextTemplates);
    const indexById = new Map(chosen.map((item, index) => [item.id, index]));
    const recurring = cadence !== 'one-time';
    const dayTemplateIds = new Set(templates.filter((item) => item.kind !== 'block').map((item) => item.id));
    const supersededOnFutureDay = (block: Block) => recurring
      && block.date > date
      && !!block.templateId
      && dayTemplateIds.has(block.templateId)
      && winningDayTemplate(block.date, nextTemplates, config, overrides)?.id === templateId;
    setBlocks(blocks
      .filter((block) => !supersededOnFutureDay(block))
      .map((block) => {
        if (block.date !== date) return block;
        const index = indexById.get(block.id);
        return index === undefined ? block : { ...block, templateId, templateIndex: index };
      }));
  };
  const useDayTemplate = (date: string, template: Template) => {
    const generatedOnDate = blocksForDate(date, blocks, templates, config, overrides).filter((block) => block.templateId && block.occurrenceKey);
    const nextTemplates = generatedOnDate.length === 0 ? templates : templates.map((item) => {
      const skipped = generatedOnDate.filter((block) => block.templateId === item.id);
      if (skipped.length === 0) return item;
      return { ...item, exceptions: skipped.reduce((next, block) => ({ ...next, [block.occurrenceKey!]: { action: 'delete' as const } }), { ...item.exceptions }) };
    });
    if (nextTemplates !== templates) setTemplates(nextTemplates);
    const applied = template.blocks.map((block, index) => ({ ...block, id: uid(), date, templateId: template.id, templateIndex: index }));
    setBlocks([...blocks.filter((block) => block.date !== date), ...applied]);
  };
  const updateTemplate = (id: string, changes: { name: string; cadence: TemplateCadence; startDate: string; enabled: boolean }) => setTemplates(templates.map((template) => template.id === id ? { ...template, ...changes } : template));
  const deleteTemplate = (id: string) => setTemplates(templates.filter((template) => template.id !== id));
  const addBlock = (date: string, data: BlockContent, options: BlockSaveOptions) => {
    setBlocks([...blocks, { ...data, id: uid(), date }]);
    if (options.saveAsTemplate) setTemplates([...templates, { id: uid(), name: data.title, blocks: [data], kind: 'block', cadence: options.cadence, startDate: options.startDate || date, enabled: true, exceptions: {} }]);
  };
  const updateBlock = (id: string, data: BlockContent) => {
    const generated = parseGeneratedOccurrence(id);
    if (!generated) { setBlocks(blocks.map((block) => block.id === id ? { ...block, ...data } : block)); return; }
    setTemplates(templates.map((template) => template.id === generated.templateId
      ? { ...template, exceptions: { ...template.exceptions, [generated.occurrenceKey]: { action: 'update', data } } }
      : template));
  };
  const deleteBlock = (id: string) => {
    const generated = parseGeneratedOccurrence(id);
    if (!generated) {
      const target = blocks.find((block) => block.id === id);
      setBlocks(blocks.filter((block) => block.id !== id));
      if (target?.templateId && target.templateIndex !== undefined) {
        const occurrenceKey = `${target.date}:${target.templateIndex}`;
        setTemplates(templates.map((template) => template.id === target.templateId
          ? { ...template, exceptions: { ...template.exceptions, [occurrenceKey]: { action: 'delete' } } }
          : template));
      }
      return;
    }
    setTemplates(templates.map((template) => template.id === generated.templateId
      ? { ...template, exceptions: { ...template.exceptions, [generated.occurrenceKey]: { action: 'delete' } } }
      : template));
  };
  const [, navigate] = useLocation();
  const goToDate = (date: string) => navigate(`/?date=${date}`);
  return <Switch>
    <Route path="/"><TodayPage config={config} blocks={blocks} templates={templates} overrides={overrides} daySettings={daySettings} onCreateBlock={addBlock} onUpdateBlock={updateBlock} onDeleteBlock={deleteBlock} onSetDaySettings={(date, settings) => setDaySettings({ ...daySettings, [date]: settings })} onSaveTemplate={saveDayTemplate} onUseTemplate={useDayTemplate} onUpdateTemplate={updateTemplate} onDeleteTemplate={deleteTemplate} /></Route>
    <Route path="/calendar"><CalendarPage config={config} blocks={blocks} templates={templates} overrides={overrides} /></Route>
    <Route path="/hitch"><HitchPage config={config} blocks={blocks} templates={templates} overrides={overrides} setOverrides={setOverrides} /></Route>
    <Route path="/settings"><SettingsPage config={config} setConfig={setConfig} overrides={overrides} setOverrides={setOverrides} daySettings={daySettings} setDaySettings={setDaySettings} /></Route>
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