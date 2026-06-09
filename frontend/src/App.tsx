import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import {
  Plus, X, Minus, RefreshCw, ArrowLeft,
  AlertTriangle, Trash2, ArrowUpDown,
  ChevronDown, ChevronRight, Users, Settings,
  ArrowRightLeft, Edit2, Check, ChevronLeft, ChevronRight as ChevronRightIcon,
  Camera, CameraOff, Info,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────

interface UserAccount {
  user_id: string;
  name: string;
  avatar_url: string;
  auto: number;
  manual: number;
  total: number;
  is_tracking: boolean;
  remark: string;
  first_seen: string;
  last_active: string;
  learned_quota: number;
}

interface ChartPoint {
  label: string;
  detailLabel?: string;
  messages: number;
  date?: string;
  month?: string;
  hour?: number;
}

interface Point2D {
  x: number;
  y: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const seedFromId = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

// Catmull-Rom 样条插值
// Monotone Cubic Spline 插值（Fritsch-Carlson 方法）
// 保证单调性：不会过冲、不会鼓包
function monotoneCubicInterpolate(values: number[], fraction: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  if (fraction <= 0) return values[0];
  if (fraction >= 1) return values[n - 1];

  // 计算斜率
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(1);
    dy.push(values[i + 1] - values[i]);
    m.push(dy[i] / dx[i]);
  }

  // 切线斜率
  const c: number[] = new Array(n).fill(0);
  c[0] = m[0];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      c[i] = 0;
    } else {
      const common = dx[i - 1] + dx[i];
      c[i] = 3 * common / ((common + dx[i]) / m[i - 1] + (common + dx[i - 1]) / m[i]);
    }
  }
  c[n - 1] = m[n - 2];

  // 插值
  const floatIndex = fraction * (n - 1);
  const i = Math.min(Math.floor(floatIndex), n - 2);
  const t = floatIndex - i;

  const h = dx[i];
  const h00 = (1 + 2 * t) * (1 - t) * (1 - t);
  const h10 = t * (1 - t) * (1 - t);
  const h01 = t * t * (3 - 2 * t);
  const h11 = t * t * (t - 1);

  return h00 * values[i] + h10 * h * c[i] + h01 * values[i + 1] + h11 * h * c[i + 1];
}

// Monotone Cubic → SVG Path（直接生成 C 指令，无需中间采样）
function monotoneCubicPath(points: Point2D[]): string {
  if (points.length < 2) return points.length === 1 ? `M ${points[0].x},${points[0].y}` : '';

  const n = points.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1].x - points[i].x);
    dy.push(points[i + 1].y - points[i].y);
    m.push(dy[i] / dx[i]);
  }

  const c: number[] = new Array(n).fill(0);
  c[0] = m[0];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      c[i] = 0;
    } else {
      const common = dx[i - 1] + dx[i];
      c[i] = 3 * common / ((common + dx[i]) / m[i - 1] + (common + dx[i - 1]) / m[i]);
    }
  }
  c[n - 1] = m[n - 2];

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = points[i].x + dx[i] / 3;
    const cp1y = points[i].y + c[i] * dx[i] / 3;
    const cp2x = points[i + 1].x - dx[i] / 3;
    const cp2y = points[i + 1].y - c[i + 1] * dx[i] / 3;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i + 1].x},${points[i + 1].y}`;
  }
  return d;
}

// ─── UserAvatar ──────────────────────────────────────────────────────

const UserAvatar: React.FC<{
  userId: string;
  avatarUrl?: string;
  active: boolean;
  size?: 'sm' | 'md' | 'lg';
}> = ({ userId, avatarUrl, active, size = 'md' }) => {
  const [imgError, setImgError] = useState(false);
  const hue = seedFromId(userId || '?') % 360;
  const letter = userId && userId.length > 0 ? userId[0].toUpperCase() : '?';
  const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={userId}
        className={`${sizeClasses} rounded-full object-cover shrink-0 border border-slate-100 dark:border-[#3a3a3c]`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-bold shrink-0 border border-white/50 dark:border-[#3a3a3c] ${active ? 'text-white shadow-sm' : 'text-slate-500 dark:text-gray-500'} ${active ? '' : 'bg-[var(--avatar-light)] dark:bg-[var(--avatar-dark)]'}`}
      style={{
        '--avatar-light': `hsl(${hue}, 40%, 90%)`,
        '--avatar-dark': `hsl(${hue}, 30%, 30%)`,
        ...(active ? { backgroundColor: `hsl(${hue}, 80%, 55%)` } : {}),
      } as React.CSSProperties}
    >
      {letter}
    </div>
  );
};

// ─── FluidChart（物理引力点收敛动画 + 鼠标位置反推悬停）──────────────────

const FluidChart: React.FC<{
  data: ChartPoint[];
  isDark?: boolean;
}> = ({ data, isDark = false }) => {
  const RESOLUTION = 120;
  const W = 780;
  const H = 180;
  const PAD_BOTTOM = 10;
  const PAD_LEFT = 24;
  const PAD_RIGHT = 32;
  const DRAW_W = W - PAD_LEFT - PAD_RIGHT;
  const AVAIL_H = H - PAD_BOTTOM;

  const pathDRef = useRef('');
  const areaDRef = useRef('');
  const svgLinePathRef = useRef<SVGPathElement>(null);
  const svgAreaPathRef = useRef<SVGPathElement>(null);
  const targetMaxRef = useRef(10);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  const currentYPx = useRef<number[]>(Array.from({ length: RESOLUTION }, () => H - PAD_BOTTOM));
  const targetYPx = useRef<number[]>(Array.from({ length: RESOLUTION }, () => H - PAD_BOTTOM));
  const animationRef = useRef<number | null>(null);
  const hasAnimatedRef = useRef(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // 记录实际数据点的 Y 坐标（用于悬停圆点精确对齐曲线）
  const actualDataYPx = useRef<number[]>([]);

  // 当前生效的 index：pinned 优先，否则 hover
  const activeIndex = pinnedIndex !== null ? pinnedIndex : hoverIndex;

  // 数据点 → SVG X 坐标
  const dataToSvgX = (index: number): number => {
    return PAD_LEFT + (index / Math.max(1, data.length - 1)) * DRAW_W;
  };

  // 数据点 → SVG Y 坐标（直接用实际数据点坐标，100% 对齐曲线）
  const dataToSvgY = (index: number): number => {
    return actualDataYPx.current[index] ?? (H - PAD_BOTTOM);
  };

  // 鼠标位置 → 最近数据点 index
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Map pixel x to SVG coordinate, then account for padding
    const svgX = (x / rect.width) * W;
    const drawX = svgX - PAD_LEFT;
    const ratio = drawX / DRAW_W;
    const idx = Math.round(ratio * (data.length - 1));
    setHoverIndex(Math.max(0, Math.min(data.length - 1, idx)));
  }, [data.length]);

  const handleMouseLeave = useCallback(() => {
    setHoverIndex(null);
  }, []);

  // 点击图表：pin 当前点；点击空白区域：取消 pin
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const svgX = (x / rect.width) * W;
    const drawX = svgX - PAD_LEFT;
    const ratio = drawX / DRAW_W;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    setPinnedIndex(idx);
  }, [data.length]);

  // 点击空白区域取消 pin
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (pinnedIndex === null) return;
      if (chartRef.current && chartRef.current.contains(e.target as Node)) return;
      setPinnedIndex(null);
    };
    document.addEventListener('mousedown', handleGlobalClick);
    return () => document.removeEventListener('mousedown', handleGlobalClick);
  }, [pinnedIndex]);

  // 物理引力点收敛动画
  useEffect(() => {
    if (!data || data.length === 0) return;

    const values = data.map(d => d.messages);
    const targetMax = Math.max(...values, 10);
    targetMaxRef.current = targetMax;

    // 计算实际数据点的目标 Y 坐标
    const actualYPx = values.map(v => {
      const safeY = Math.max(0, v);
      return H - PAD_BOTTOM - ((safeY / targetMax) * AVAIL_H);
    });
    actualDataYPx.current = actualYPx;

    const newTargetYPx: number[] = [];
    for (let i = 0; i < RESOLUTION; i++) {
      const fraction = i / (RESOLUTION - 1);
      const val = monotoneCubicInterpolate(values, fraction);
      const safeY = Math.max(0, val);
      const y = H - PAD_BOTTOM - ((safeY / targetMax) * AVAIL_H);
      newTargetYPx.push(y);
    }
    targetYPx.current = newTargetYPx;

    if (!hasAnimatedRef.current) {
      hasAnimatedRef.current = true;
      currentYPx.current = Array.from({ length: RESOLUTION }, () => H - PAD_BOTTOM);
    }

    const CONVERGE_SPEED = 0.12;

    const animate = () => {
      let allConverged = true;
      const nextYPx: number[] = [];

      for (let i = 0; i < RESOLUTION; i++) {
        const current = currentYPx.current[i];
        const target = targetYPx.current[i];
        const diff = target - current;

        if (Math.abs(diff) > 0.5) {
          allConverged = false;
          nextYPx.push(current + diff * CONVERGE_SPEED);
        } else {
          nextYPx.push(target);
        }
      }

      currentYPx.current = nextYPx;

      // 用实际数据点坐标生成 Monotone Cubic Path（无需中间采样）
      const dataPoints: Point2D[] = actualYPx.map((_, i) => ({
        x: dataToSvgX(i),
        y: currentYPx.current[Math.round((i / Math.max(1, data.length - 1)) * (RESOLUTION - 1))],
      }));

      const linePath = monotoneCubicPath(dataPoints);
      pathDRef.current = linePath;
      areaDRef.current = `${linePath} L ${dataToSvgX(data.length - 1)},${H - PAD_BOTTOM} L ${PAD_LEFT},${H - PAD_BOTTOM} Z`;
      if (svgLinePathRef.current) svgLinePathRef.current.setAttribute('d', linePath);
      if (svgAreaPathRef.current) svgAreaPathRef.current.setAttribute('d', areaDRef.current);

      if (!allConverged) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [data]);

  return (
    <div className="relative w-full h-full flex flex-col pt-4">
      <div className="flex-1 relative" ref={chartRef}>
        {/* SVG 绘图层 */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full overflow-visible"
        >
          <defs>
            <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={isDark ? '#6e9eff' : '#3b82f6'} stopOpacity={isDark ? 0.3 : 0.3} />
              <stop offset="100%" stopColor={isDark ? '#6e9eff' : '#3b82f6'} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Area fill (blue) */}
          <path ref={svgAreaPathRef} d={areaDRef.current} fill="url(#chartGradient)" shapeRendering="geometricPrecision" style={{ transform: 'translateZ(0)', willChange: 'd' }} />
          {/* Line - below quota (blue) */}
          <path
            ref={svgLinePathRef}
            d={pathDRef.current}
            fill="none"
            stroke={isDark ? '#6e9eff' : '#3b82f6'}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            shapeRendering="geometricPrecision"
            style={{ transform: 'translateZ(0)', willChange: 'd' }}
          />
        </svg>

        {/* 悬停指示线（SVG 层，non-scaling-stroke 保持 1px） */}
        {activeIndex !== null && (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          >
            <line
              x1={dataToSvgX(activeIndex)}
              y1={0}
              x2={dataToSvgX(activeIndex)}
              y2={H - PAD_BOTTOM}
              stroke={isDark ? '#6e9eff' : '#93c5fd'}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              shapeRendering="geometricPrecision"
            />
          </svg>
        )}

        {/* 悬停圆点（HTML 层，永远保持正圆） */}
        {activeIndex !== null && (() => {
          const containerW = chartRef.current?.clientWidth || 1;
          const containerH = chartRef.current?.clientHeight || 1;
          const pxX = (dataToSvgX(activeIndex) / W) * containerW;
          const pxY = (dataToSvgY(activeIndex) / H) * containerH;
          return (
            <>
              {/* 外圈光晕 */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: pxX - 8,
                  top: pxY - 8,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: isDark ? '#6e9eff' : '#3b82f6',
                  opacity: 0.15,
                }}
              />
              {/* 内圈实心点 */}
              <div
                className="absolute pointer-events-none"
                style={{
                  left: pxX - 5,
                  top: pxY - 5,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isDark ? '#6e9eff' : '#3b82f6',
                  border: `2px solid ${isDark ? '#1e1e1e' : 'white'}`,
                }}
              />
            </>
          );
        })()}

        {/* 鼠标感应层 — 单层透明覆盖，用 clientX 反推 index */}
        <div
          className="absolute inset-0 cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleChartClick}
        />

        {/* Tooltip（HTML 层，自动躲避容器边缘） */}
        {activeIndex !== null && (() => {
          const pct = (dataToSvgX(activeIndex) / W) * 100;
          // 边缘躲避：左 8% ~ 右 92% 范围内居中，超出则偏移
          const clampedPct = Math.max(12, Math.min(88, pct));
          return (
            <div
              className="absolute bottom-full mb-2 bg-white/95 dark:bg-[#2d2d2d]/95 backdrop-blur-md border border-slate-200 dark:border-[#3a3a3c] shadow-xl rounded-lg px-3 py-2 text-xs z-50 whitespace-nowrap pointer-events-none"
              style={{
                left: `${clampedPct}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <p className="text-slate-500 dark:text-gray-500 mb-1">{data[activeIndex].detailLabel ?? data[activeIndex].label}</p>
              <p className={`font-semibold flex items-center gap-1.5 ${isDark ? 'text-[#6e9eff]' : 'text-blue-600'}`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block shadow-sm ${isDark ? 'bg-[#6e9eff] shadow-[#6e9eff]/50' : 'bg-blue-500 shadow-blue-500/50'}`} />
                {data[activeIndex].messages} 条消息
              </p>
            </div>
          );
        })()}
      </div>

      {/* X 轴标签 */}
      <div
        className="h-6 mt-1 relative text-[11px] text-slate-400 dark:text-gray-500 font-medium"
        style={{ marginLeft: `${(PAD_LEFT / W) * 100}%`, marginRight: `${(PAD_RIGHT / W) * 100}%` }}
      >
        {data.map((d, i) => {
          const len = data.length;
          const maxLabels = 6;
          const step = Math.max(1, Math.ceil(len / maxLabels));
          const show = i === 0 || i === len - 1 || (i % step === 0 && i !== len - 1);

          const leftPct = (i / Math.max(1, len - 1)) * 100;
          const isFirst = i === 0;
          const isLast = i === len - 1;

          return (
            <span
              key={i}
              className={`absolute whitespace-nowrap pointer-events-none ${isFirst ? '' : isLast ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: `${leftPct}%`, opacity: show ? 1 : 0 }}
            >
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ─── GlassCircleButton（液态玻璃圆圈按钮）────────────────────────────────

const GlassCircleButton: React.FC<{
  onClick: () => void;
  isDark: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  className?: string;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onMouseLeave?: () => void;
}> = ({ onClick, isDark, disabled = false, children, title, className = '', onMouseDown, onMouseUp, onMouseLeave }) => (
  <button
    onClick={onClick}
    onMouseDown={onMouseDown}
    onMouseUp={onMouseUp}
    onMouseLeave={onMouseLeave}
    disabled={disabled}
    title={title}
    className={`flex items-center justify-center rounded-full transition-opacity duration-200 outline-none select-none ${className}`}
    style={{
      width: 28,
      height: 28,
      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.45)',
      backdropFilter: 'blur(1px)',
      WebkitBackdropFilter: 'blur(1px)',
      border: isDark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.08)',
      boxShadow: isDark
        ? '0 0 0 0.5px rgba(255,255,255,0.04), inset 0 0.5px 1px rgba(255,255,255,0.06)'
        : '0 0 0 0.5px rgba(0,0,0,0.04), inset 0 0.5px 1px rgba(255,255,255,0.5)',
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    {children}
  </button>
);

// ─── TimeSwitcher（液态玻璃滑动指示器）────────────────────────────────

const TIME_TABS = [
  { key: 'day', label: '今日' },
  { key: 'week', label: '近7天' },
  { key: 'month', label: '近30天' },
];

const TimeSwitcher: React.FC<{
  timeView: string;
  setTimeView: (v: string) => void;
  isDark: boolean;
}> = ({ timeView, setTimeView, isDark }) => {
  const activeIndex = TIME_TABS.findIndex(t => t.key === timeView);
  const [isReady, setIsReady] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const el = tabRefs.current[activeIndex];
    if (el) {
      setIndicatorStyle({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
      if (!isReady) setIsReady(true);
    }
  }, [activeIndex, isReady]);

  return (
    <div className="flex items-center p-1 rounded-full whitespace-nowrap opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-auto"
      style={{
        background: 'transparent',
        backdropFilter: 'blur(1.5px)',
        WebkitBackdropFilter: 'blur(1.5px)',
        border: isDark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.08)',
        boxShadow: isDark
          ? '0 0 0 0.5px rgba(255,255,255,0.04), inset 0 0.5px 1px rgba(255,255,255,0.06)'
          : '0 0 0 0.5px rgba(0,0,0,0.04), inset 0 0.5px 1px rgba(255,255,255,0.5)',
      }}
    >
      {/* 滑动指示器 */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: indicatorStyle.left,
          top: indicatorStyle.top,
          width: indicatorStyle.width,
          height: indicatorStyle.height,
          opacity: isReady ? 1 : 0,
          background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.85)',
          boxShadow: isDark
            ? '0 1px 4px rgba(0,0,0,0.15), inset 0 0.5px 0.5px rgba(255,255,255,0.04)'
            : '0 2px 4px rgba(0,0,0,0.08), inset 0 1px 1px rgba(255,255,255,0.9)',
          border: isDark ? '0.5px solid rgba(255,255,255,0.08)' : '0.5px solid rgba(0,0,0,0.04)',
          transition: isReady ? 'left 0.4s cubic-bezier(0.25,0.8,0.25,1), top 0.4s cubic-bezier(0.25,0.8,0.25,1), width 0.4s cubic-bezier(0.25,0.8,0.25,1), height 0.4s cubic-bezier(0.25,0.8,0.25,1)' : 'none',
        }}
      />
      {TIME_TABS.map((tv, index) => {
        const isActive = activeIndex === index;
        return (
          <button
            key={tv.key}
            ref={el => { tabRefs.current[index] = el; }}
            onClick={() => setTimeView(tv.key)}
            className={`relative z-10 px-3 py-1 text-[11px] font-semibold transition-colors duration-200 outline-none select-none ${
              isActive
                ? isDark ? 'text-[#6e9eff]' : 'text-blue-600'
                : isDark ? 'text-[#8e8e93] hover:text-[#e5e5e5]' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tv.label}
          </button>
        );
      })}
    </div>
  );
};

const sortAccounts = (accounts: UserAccount[], sortBy: string, lastActiveUserId: string | null): UserAccount[] => {
  return [...accounts].sort((a, b) => {
    if (sortBy === 'active') {
      if (a.user_id === lastActiveUserId && b.user_id !== lastActiveUserId) return -1;
      if (b.user_id === lastActiveUserId && a.user_id !== lastActiveUserId) return 1;
      return b.total - a.total;
    }
    return b.total - a.total;
  });
};

// ─── App ─────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [timeView, setTimeView] = useState<string>('day');
  const [view, setView] = useState<string>('main');
  const [sortBy, setSortBy] = useState<string>('active');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualModal, setManualModal] = useState<{ show: boolean; delta: number }>({ show: false, delta: 0 });
  const [weekHistory, setWeekHistory] = useState<ChartPoint[]>([]);
  const [monthHistory, setMonthHistory] = useState<ChartPoint[]>([]);
  const [yearHistory, setYearHistory] = useState<ChartPoint[]>([]);
  const [hourlyData, setHourlyData] = useState<ChartPoint[]>([]);
  const [lastActiveUserId, setLastActiveUserId] = useState<string | null>(null);
  const lastActiveUserIdRef = useRef<string | null>(null);
  useEffect(() => { lastActiveUserIdRef.current = lastActiveUserId; }, [lastActiveUserId]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showManualPopover, setShowManualPopover] = useState(false);
  const [popoverValue, setPopoverValue] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingRemarkId, setEditingRemarkId] = useState<string | null>(null);
  const [remarkValue, setRemarkValue] = useState('');
  const [switchConfirmId, setSwitchConfirmId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);
  const [currentTraeUserId, setCurrentTraeUserId] = useState<string>('');
  const [snapshotStatus, setSnapshotStatus] = useState<Record<string, boolean>>({}); // userID -> hasSnapshot
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [snapshotConfirmId, setSnapshotConfirmId] = useState<{ userId: string; action: 'take' | 'delete' } | null>(null);
  const [isUserSwitching, setIsUserSwitching] = useState(false); // Whether we're in the middle of a user switch
  const isUserSwitchingRef = useRef(false);
  useEffect(() => { isUserSwitchingRef.current = isUserSwitching; }, [isUserSwitching]);
  const [isManualSelect, setIsManualSelect] = useState(false); // 用户手动选择了其他账号查看，不自动切回
  const isManualSelectRef = useRef(false);
  const prevTotalRef = useRef<number>(0);
  useEffect(() => { isManualSelectRef.current = isManualSelect; }, [isManualSelect]);
  const [showSettings, setShowSettings] = useState(false);
  const [controlStripPinned, setControlStripPinned] = useState(false);
  const [theme, setTheme] = useState<string>('system');
  const [quotaInfo, setQuotaInfo] = useState<{ quota: number; used: number; next_flash: number; is_exhausted: boolean; identity_str: string; fast_request_per: number; exhaust_source: string } | null>(null);
  const [warningThreshold, setWarningThreshold] = useState(40);
  const [alertThreshold, setAlertThreshold] = useState(50);
  const [dockHidden, setDockHidden] = useState(true);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(true);
  const [autoThreshold, setAutoThreshold] = useState(false);
  const [learnedQuota, setLearnedQuota] = useState(0);
  const [dailyLearnedQuota, setDailyLearnedQuota] = useState(0); // 查看历史日期时当天的学习上限
  const [manualQuota, setManualQuota] = useState(58);
  const [dayOffset, setDayOffset] = useState(0); // 0=今天, 1=昨天, 2=前天...
  const [showAllAccounts, setShowAllAccounts] = useState(false); // 是否显示当天无数据的账号
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const manualPopoverRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverLongPressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const popoverLongPressDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navLongPressDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navLongPressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navLongPressActivatedRef = useRef(false);

  const navLongPressStop = useCallback(() => {
    if (navLongPressDelayRef.current) { clearTimeout(navLongPressDelayRef.current); navLongPressDelayRef.current = null; }
    if (navLongPressIntervalRef.current) { clearInterval(navLongPressIntervalRef.current); navLongPressIntervalRef.current = null; }
  }, []);

  const navLongPressStart = useCallback((delta: number) => {
    navLongPressStop();
    navLongPressActivatedRef.current = false;
    navLongPressDelayRef.current = setTimeout(() => {
      navLongPressActivatedRef.current = true;
      navLongPressIntervalRef.current = setInterval(() => {
        setDayOffset(prev => delta > 0 ? prev + 1 : Math.max(0, prev - 1));
      }, 300);
      // 立即触发第一次
      setDayOffset(prev => delta > 0 ? prev + 1 : Math.max(0, prev - 1));
    }, 500);
  }, [navLongPressStop]);

  const navClick = useCallback((delta: number) => {
    if (navLongPressActivatedRef.current) {
      navLongPressActivatedRef.current = false;
      return; // 长按激活后松手，不再触发点击
    }
    setDayOffset(prev => delta > 0 ? prev + 1 : Math.max(0, prev - 1));
  }, []);

  const popoverStep = (delta: number) => {
    setPopoverValue(prev => {
      const cur = parseInt(prev, 10) || 0;
      return String(Math.max(-300, Math.min(300, cur + delta)));
    });
  };

  // Use a ref to always have the latest activeId available in event handlers
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const notifyEnabledRef = useRef(true);
  useEffect(() => { notifyEnabledRef.current = notifyEnabled; }, [notifyEnabled]);
  const warningThresholdRef = useRef(40);
  useEffect(() => { warningThresholdRef.current = warningThreshold; }, [warningThreshold]);
  const alertThresholdRef = useRef(50);
  useEffect(() => { alertThresholdRef.current = alertThreshold; }, [alertThreshold]);
  const learnedQuotaRef = useRef(0);
  useEffect(() => { learnedQuotaRef.current = learnedQuota; }, [learnedQuota]);
  const manualQuotaRef = useRef(58);
  useEffect(() => { manualQuotaRef.current = manualQuota; }, [manualQuota]);
  const autoThresholdRef = useRef(false);
  useEffect(() => { autoThresholdRef.current = autoThreshold; }, [autoThreshold]);
  const startPopoverLongPress = (delta: number) => {
    popoverStep(delta);
    // Delay 500ms before starting repeat
    popoverLongPressDelayRef.current = setTimeout(() => {
      popoverLongPressRef.current = setInterval(() => popoverStep(delta), 120);
    }, 500);
  };
  const stopPopoverLongPress = () => {
    if (popoverLongPressDelayRef.current) {
      clearTimeout(popoverLongPressDelayRef.current);
      popoverLongPressDelayRef.current = null;
    }
    if (popoverLongPressRef.current) {
      clearInterval(popoverLongPressRef.current);
      popoverLongPressRef.current = null;
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowUserDropdown(false);
      }
      if (manualPopoverRef.current && !manualPopoverRef.current.contains(event.target as Node)) {
        setShowManualPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettings]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshData = useCallback(async (targetUserId?: string) => {
    try {
      let userCounts: UserAccount[] | undefined, lastActive: string | undefined;
      let week: any[], month: any[], year: any[], hourly: any[];

      if ((window as any)?.go?.main?.App) {
        const App = (window as any).go.main.App;
        userCounts = await App.GetAllUserTodayCounts();
        lastActive = await App.GetLastActiveUser();
        const uid = targetUserId || activeId || lastActive || '';
        [week, month, year] = await Promise.all([
          App.GetWeekHistory(uid),
          App.GetMonthHistory(uid),
          App.GetYearHistory(uid),
        ]);

        // Load hourly data for the selected day offset
        if (dayOffset > 0) {
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - dayOffset);
          // Use local date formatting to avoid UTC offset issues
          const y = targetDate.getFullYear();
          const m = String(targetDate.getMonth() + 1).padStart(2, '0');
          const d = String(targetDate.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;
          hourly = await App.GetHourlyCountsForDate(uid, dateStr);
        } else {
          hourly = await App.GetHourlyCounts(uid);
        }
      } else {
        return;
      }

      if (userCounts && userCounts.length > 0) {
        setAccounts(userCounts);
        // Track current user's total for count-increase detection
        const currentUser = userCounts.find((u: UserAccount) => u.user_id === (lastActiveUserIdRef.current || lastActive));
        if (currentUser) {
          prevTotalRef.current = currentUser.total;
        }
        // Don't update lastActiveUserId during switch — GetLastActiveUser() may
        // return stale data. The currentUserChanged event handles this.
        // Also don't update when user is manually viewing another account's data.
        if (!isUserSwitchingRef.current && !isManualSelectRef.current) {
          setLastActiveUserId(lastActive || null);
        }

        // Load snapshot status for all users
        if ((window as any)?.go?.main?.App) {
          const newStatus: Record<string, boolean> = {};
          for (const uc of userCounts) {
            try {
              newStatus[uc.user_id] = await (window as any).go.main.App.HasSnapshot(uc.user_id);
            } catch { newStatus[uc.user_id] = false; }
          }
          setSnapshotStatus(newStatus);
        }

        if (week) setWeekHistory(week.map((d: any) => ({ date: d.date, label: d.date.substring(5), detailLabel: d.date, messages: d.count })));
        if (month) setMonthHistory(month.map((d: any) => ({ date: d.date, label: d.date.substring(8), detailLabel: d.date, messages: d.count })));
        if (year) setYearHistory(year.map((d: any) => ({ month: d.month, label: d.month.substring(5), detailLabel: d.month, messages: d.count })));
        if (hourly) setHourlyData(hourly.map((h: any) => ({ hour: h.hour, label: `${h.hour}`, detailLabel: `${h.hour}:00`, messages: h.count })));
      }

      // Learn quota from exhaustion events and auto-adjust thresholds
      if ((window as any)?.go?.main?.App) {
        // Get current Trae user ID — use last_active_user from DB (not log detection)
        // which is the source of truth after account switches.
        // IMPORTANT: Don't overwrite currentTraeUserId during a switch —
        // GetLastActiveUser() may return stale data, and the currentUserChanged
        // event is the authoritative source during switches.
        try {
          if (!isUserSwitchingRef.current) {
            const isLoggedIn = await (window as any).go.main.App.IsTraeLoggedIn();
            if (isLoggedIn) {
              const curId = await (window as any).go.main.App.GetLastActiveUser();
              if (curId) {
                setCurrentTraeUserId(curId);
              }
            } else {
              setCurrentTraeUserId('');
            }
          }
        } catch {}
        await (window as any).go.main.App.RecordAndLearnQuota();
        // Refresh thresholds if auto-threshold is enabled
        const auto = await (window as any).go.main.App.GetAutoThreshold();
        if (auto) {
          const wt = await (window as any).go.main.App.GetWarningThreshold();
          const at = await (window as any).go.main.App.GetAlertThreshold();
          setWarningThreshold(wt);
          setAlertThreshold(at);
        }
        // Update learned quota display for current user
        const currentUid = targetUserId || activeId || lastActive || '';
        const lq = await (window as any).go.main.App.GetLearnedQuota(currentUid);
        setLearnedQuota(lq);
        // When viewing historical data, also fetch that day's learned quota
        if (dayOffset > 0 && currentUid) {
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - dayOffset);
          const y = targetDate.getFullYear();
          const m = String(targetDate.getMonth() + 1).padStart(2, '0');
          const d = String(targetDate.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${d}`;
          const dlq = await (window as any).go.main.App.GetLearnedQuotaForDate(currentUid, dateStr);
          setDailyLearnedQuota(dlq);
        } else {
          setDailyLearnedQuota(0);
        }
        // Also refresh quota info
        (window as any).go.main.App.GetQuotaInfo().then((info: any) => {
          if (info) setQuotaInfo(info);
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Failed to refresh data:', e);
    }
  }, [activeId, dayOffset]);

  const refreshDataDebounced = useCallback(async (uid?: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshData(uid);
      refreshTimerRef.current = null;
    }, 500);
  }, [refreshData]);

  // Use ref to avoid stale closure in event callbacks
  const refreshDataDebouncedRef = useRef(refreshDataDebounced);
  useEffect(() => { refreshDataDebouncedRef.current = refreshDataDebounced; }, [refreshDataDebounced]);

  // Check notification thresholds and send notification if needed
  // Uses persistent storage (app_state) to track which notifications have already been sent
  // per user per day, so we never notify twice even after app restart.
  const checkAndNotify = useCallback(async () => {
    if (!notifyEnabledRef.current || !(window as any)?.go?.main?.App) return;
    if (isUserSwitchingRef.current) return; // Don't notify during switch
    try {
      const result = await (window as any).go.main.App.GetTodayCount();
      const count = result?.total || 0;
      const activeId = lastActiveUserIdRef.current;
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const effectiveQuota = autoThresholdRef.current ? learnedQuotaRef.current : manualQuotaRef.current;
      const isExhausted = effectiveQuota > 0 && count >= effectiveQuota;
      const at = alertThresholdRef.current;
      const wt = warningThresholdRef.current;

      if (isExhausted && activeId) {
        const alreadyNotified = await (window as any).go.main.App.HasNotifiedExhaustion(activeId, today);
        if (!alreadyNotified) {
          await (window as any).go.main.App.SendNotificationWithType('Trae 额度耗尽', `${activeNameRef.current} 今日额度已用完，将在明日重置`, 'exhausted');
          await (window as any).go.main.App.MarkNotifiedExhaustion(activeId, today);
        }
      } else if (count >= at && activeId) {
        const alreadyNotified = await (window as any).go.main.App.HasNotifiedAlert(activeId, today);
        if (!alreadyNotified) {
          await (window as any).go.main.App.SendNotificationWithType('Trae 额度警告', `${activeNameRef.current} 今日已使用 ${count} 次，额度即将达到上限！`, 'alert');
          await (window as any).go.main.App.MarkNotifiedAlert(activeId, today);
        }
      } else if (count >= wt && activeId) {
        const alreadyNotified = await (window as any).go.main.App.HasNotifiedWarning(activeId, today);
        if (!alreadyNotified) {
          await (window as any).go.main.App.SendNotificationWithType('Trae 额度提醒', `${activeNameRef.current} 今日已使用 ${count} 次，请注意使用量`, 'remind');
          await (window as any).go.main.App.MarkNotifiedWarning(activeId, today);
        }
      }
    } catch {}
  }, [accounts]);

  const initialized = useRef(false);
  useEffect(() => {
    refreshDataDebounced();
    if ((window as any)?.runtime?.EventsOn) {
      (window as any).runtime.EventsOn('countUpdated', async () => {
        // Only auto-return to current user if the count actually increased
        if (isManualSelectRef.current && lastActiveUserIdRef.current) {
          // Fetch latest counts to check if current user's total increased
          try {
            if ((window as any)?.go?.main?.App) {
              const userCounts: UserAccount[] = await (window as any).go.main.App.GetAllUserTodayCounts();
              const currentUser = userCounts?.find((u: UserAccount) => u.user_id === lastActiveUserIdRef.current);
              if (currentUser && currentUser.total > prevTotalRef.current) {
                // Count increased — auto-switch back to current user
                setIsManualSelect(false);
                setActiveId(lastActiveUserIdRef.current);
                prevTotalRef.current = currentUser.total;
              } else if (currentUser) {
                // Count unchanged — update prevTotalRef but don't switch
                prevTotalRef.current = currentUser.total;
              }
            }
          } catch { /* ignore */ }
        }
        // Refresh chart data for the current user (don't auto-switch away from user's selection)
        refreshDataDebouncedRef.current();

        // Check notification thresholds
        checkAndNotify();
      });
      // Listen for current user changes (e.g. after switching accounts)
      (window as any).runtime.EventsOn('currentUserChanged', async (userId: string) => {
        setCurrentTraeUserId(userId);
        setIsUserSwitching(false);
        // If user is manually viewing another account, don't auto-switch back
        if (isManualSelectRef.current) return;
        // Switch activeId to the new user and refresh
        setActiveId(userId);
        refreshDataDebouncedRef.current(userId);
      });
    }
    // Listen for system theme changes when in "system" mode
    if ((window as any)?.go?.main?.App) {
      (window as any).go.main.App.GetControlStripPinned().then((pinned: boolean) => {
        setControlStripPinned(pinned);
      }).catch(() => {});
      (window as any).go.main.App.GetTheme().then((t: string) => {
        setTheme(t || 'system');
        applyThemeToDocument(t || 'system');
      }).catch(() => {});
      // Load quota info
      (window as any).go.main.App.GetQuotaInfo().then((info: any) => {
        if (info) setQuotaInfo(info);
      }).catch(() => {});
      // Load warning/alert thresholds
      (window as any).go.main.App.GetWarningThreshold().then((v: number) => {
        setWarningThreshold(v);
      }).catch(() => {});
      (window as any).go.main.App.GetAlertThreshold().then((v: number) => {
        setAlertThreshold(v);
      }).catch(() => {});
      // Load dock/launch settings
      (window as any).go.main.App.GetDockHidden().then((v: boolean) => {
        setDockHidden(v);
      }).catch(() => {});
      (window as any).go.main.App.GetAutoLaunch().then((v: boolean) => {
        setAutoLaunch(v);
      }).catch(() => {});
      (window as any).go.main.App.GetNotifyEnabled().then((v: boolean) => {
        setNotifyEnabled(v);
      }).catch(() => {});
      (window as any).go.main.App.GetAutoThreshold().then((v: boolean) => {
        setAutoThreshold(v);
      }).catch(() => {});
      (window as any).go.main.App.GetLearnedQuota('').then((v: number) => {
        setLearnedQuota(v);
      }).catch(() => {});
      (window as any).go.main.App.GetManualQuota().then((v: number) => {
        setManualQuota(v);
      }).catch(() => {});
      (window as any).go.main.App.GetShowAllAccounts().then((v: boolean) => {
        setShowAllAccounts(v);
      }).catch(() => {});
    }
    // Listen for system theme changes when in "system" mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      setSystemIsDark(mediaQuery.matches);
      setTheme(prev => {
        if (prev === 'system') {
          applyThemeToDocument('system');
        }
        return prev;
      });
    };
    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, []);

  useEffect(() => {
    if (!initialized.current && accounts.length > 0) {
      initialized.current = true;
      (async () => {
        let savedId: string | null = null;
        if ((window as any)?.go?.main?.App) savedId = await (window as any).go.main.App.GetSelectedUser();
        const lastActive = lastActiveUserId || null;
        const matched = (savedId && accounts.find(a => a.user_id === savedId)) ||
          (lastActive && accounts.find(a => a.user_id === lastActive)) ||
          accounts.find(a => a.is_tracking && a.total > 0) ||
          accounts[0];
        setActiveId(matched.user_id);
      })();
    }
  }, [accounts, lastActiveUserId]);

  useEffect(() => {
    if (initialized.current && activeId) {
      if ((window as any)?.go?.main?.App) (window as any).go.main.App.SaveSelectedUser(activeId);
      refreshData(activeId);
    }
  }, [activeId]);

  // Refresh data when dayOffset changes (only in 'day' view)
  useEffect(() => {
    if (timeView === 'day' && initialized.current) {
      refreshData();
    }
  }, [dayOffset, refreshData]);

  // Reset dayOffset when switching away from 'day' view
  useEffect(() => {
    if (timeView !== 'day') {
      setDayOffset(0);
    }
  }, [timeView]);

  const activeAccount = useMemo(() => accounts.find(a => a.user_id === activeId) || accounts[0], [accounts, activeId]);
  // Keep latest user name in a ref for notification callbacks (avoids stale closure)
  const activeNameRef = useRef('当前用户');
  useEffect(() => { activeNameRef.current = activeAccount?.name || '当前用户'; }, [activeAccount]);

  const isDark = useMemo(() => {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return systemIsDark;
  }, [theme, systemIsDark]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (timeView === 'day' && hourlyData.length > 0) return hourlyData;
    if (timeView === 'week' && weekHistory.length > 0) return weekHistory;
    if (timeView === 'month' && monthHistory.length > 0) return monthHistory;
    if (timeView === 'year' && yearHistory.length > 0) return yearHistory;
    return [];
  }, [timeView, hourlyData, weekHistory, monthHistory, yearHistory]);

  const mainViewAccounts = useMemo(() => {
    const filtered = showAllAccounts
      ? accounts
      : accounts.filter(a => a.total > 0 || a.user_id === activeId);
    return sortAccounts(filtered, sortBy, lastActiveUserId);
  }, [accounts, sortBy, lastActiveUserId, activeId, showAllAccounts]);

  const allViewAccounts = useMemo(() => {
    return sortAccounts(accounts, sortBy, lastActiveUserId);
  }, [accounts, sortBy, lastActiveUserId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (dayOffset > 0) setDayOffset(0);
      if ((window as any)?.go?.main?.App) {
        await (window as any).go.main.App.Refresh();
        (window as any).go.main.App.GetQuotaInfo().then((info: any) => {
          if (info) setQuotaInfo(info);
        }).catch(() => {});
      }
      // Use debounced refresh to avoid conflicting with countUpdated event
      // which is also triggered by App.Refresh()
      refreshDataDebouncedRef.current();
    } catch (e) { /* ignore */ }
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const closeManualModal = () => setManualModal({ show: false, delta: 0 });
  const adjustManualValue = (amount: number) => setManualModal(prev => ({ ...prev, delta: prev.delta + amount }));

  const startLongPress = (amount: number) => {
    adjustManualValue(amount);
    // Delay 500ms before starting repeat
    longPressDelayRef.current = setTimeout(() => {
      longPressTimerRef.current = setInterval(() => adjustManualValue(amount), 120);
    }, 500);
  };
  const stopLongPress = () => {
    if (longPressDelayRef.current) {
      clearTimeout(longPressDelayRef.current);
      longPressDelayRef.current = null;
    }
    if (longPressTimerRef.current) {
      clearInterval(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeManualPopover = () => setShowManualPopover(false);

  const confirmManualPopover = async () => {
    let newVal = parseInt(popoverValue, 10);
    if (isNaN(newVal) || popoverValue === '') {
      newVal = 0;
    }
    newVal = Math.max(-300, Math.min(300, newVal));
    if (activeAccount) {
      const delta = newVal - (activeAccount.manual || 0);
      if (delta !== 0) {
        try {
          if ((window as any)?.go?.main?.App) await (window as any).go.main.App.AdjustUserManual(activeAccount.user_id, delta);
          await refreshData();
          checkAndNotify();
        } catch (e) { /* ignore */ }
      }
    }
    setShowManualPopover(false);
  };

  const confirmManualAdjust = async () => {
    if (manualModal.delta !== 0 && activeAccount) {
      try {
        if ((window as any)?.go?.main?.App) await (window as any).go.main.App.AdjustUserManual(activeAccount.user_id, manualModal.delta);
        await refreshData();
        checkAndNotify();
      } catch (e) { /* ignore */ }
    }
    closeManualModal();
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      if ((window as any)?.go?.main?.App) await (window as any).go.main.App.DeleteUser(userId);
      if (activeId === userId) {
        const remaining = accounts.filter(a => a.user_id !== userId);
        setActiveId(remaining.length > 0 ? remaining[0].user_id : null);
      }
      setDeleteConfirmId(null);
      setExpandedId(null);
      await refreshData();
    } catch (e) { /* ignore */ }
  };

  const toggleSort = () => setSortBy(prev => prev === 'active' ? 'count' : 'active');

  const toggleControlStrip = async () => {
    const newVal = !controlStripPinned;
    try {
      if ((window as any)?.go?.main?.App) {
        await (window as any).go.main.App.SetControlStripPinned(newVal);
        setControlStripPinned(newVal);
      }
    } catch (e) { /* ignore */ }
  };

  const applyThemeToDocument = (t: string) => {
    if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const changeTheme = async (newTheme: string) => {
    try {
      if ((window as any)?.go?.main?.App) {
        await (window as any).go.main.App.SetTheme(newTheme);
        setTheme(newTheme);
        applyThemeToDocument(newTheme);
      }
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="h-screen select-none bg-white dark:bg-[#1e1e1e] flex flex-col relative font-sans text-slate-800 dark:text-white overflow-hidden">
      {/* Title Bar */}
      <div className="h-[38px] flex items-center px-4 pl-[72px] relative shrink-0 border-b border-slate-100 dark:border-[#333] bg-white/90 dark:bg-[#2d2d2d]/90 backdrop-blur-md z-20" style={{'--wails-draggable': 'drag'} as React.CSSProperties}>
        <div className="flex items-center" style={{'--wails-draggable': 'no-drag'} as React.CSSProperties}>
          <span className="text-[13px] font-semibold text-slate-700 dark:text-white leading-none mt-[1.5px]">Trae 对话计数</span>
        </div>
        <div className="absolute right-4 flex items-center gap-3 z-10" style={{'--wails-draggable': 'no-drag'} as React.CSSProperties}>
          <button onClick={handleRefresh} className="text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-[#e5e5e5] transition-colors outline-none" title="刷新数据">
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-blue-500' : ''} />
          </button>
          <button onClick={() => setShowSettings(!showSettings)} className={`transition-colors outline-none ${showSettings ? 'text-blue-500 dark:text-[#4daafc]' : 'text-slate-400 dark:text-gray-500 hover:text-slate-700 dark:hover:text-[#e5e5e5]'}`} title="设置">
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Core View Area */}
      <div className="flex-1 relative overflow-hidden bg-gray-50 dark:bg-[#252526]">

        {/* Main View */}
        {view === 'main' && (
        <div className="absolute inset-0 flex flex-col p-3 bg-white dark:bg-[#1e1e1e] animate-in fade-in zoom-in-95 duration-200">

          {/* Stats Area: 大数字 + 标签 + 右侧详情 */}
          <div className="flex justify-between items-start relative z-30 min-h-[35%] md:min-h-[45%] lg:min-h-[55%] max-h-[65%]">
            {/* 左侧：大数字 + 标签 */}
            <div className="flex-1 min-w-0 flex flex-col items-center">
              {(() => {
                if (isUserSwitching) {
                  return (
                    <div className="font-black tracking-tight text-slate-300 dark:text-[#3a3a3c] leading-none transition-colors duration-300" style={{ fontSize: 'clamp(56px, max(15vw, 15vh), 140px)' }}>
                      —
                    </div>
                  );
                }
                const effectiveQuota = autoThreshold
                  ? (dayOffset > 0 && dailyLearnedQuota > 0 ? dailyLearnedQuota : learnedQuota)
                  : manualQuota;
                // When viewing historical data, sum hourly data for total
                const historicalTotal = dayOffset > 0 ? hourlyData.reduce((sum, h) => sum + h.messages, 0) : 0;
                const count = dayOffset > 0 ? historicalTotal : (activeAccount?.total || 0);
                // Only use effectiveQuota for color — quotaInfo.is_exhausted is global (current Trae user)
                // and may not match the account being viewed
                const overQuota = effectiveQuota > 0 && count > effectiveQuota;
                const atAlert = !overQuota && effectiveQuota > 0 && count >= effectiveQuota - 5;
                const numColor = overQuota
                  ? 'text-red-500 dark:text-red-400'
                  : atAlert
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-slate-800 dark:text-[#ffffff]';
                return (
                  <div className={`font-black tracking-tight ${numColor} leading-none transition-colors duration-300`} style={{ fontSize: 'clamp(56px, max(15vw, 15vh), 140px)' }}>
                    {count}
                  </div>
                );
              })()}
              <div className="flex items-center justify-center gap-1.5 mt-1 h-4">
                <span className="text-[clamp(11px,2.5vw,14px)] text-slate-400 dark:text-[#8e8e93] font-medium whitespace-nowrap">
                  {dayOffset === 0 ? '今日总消息' : dayOffset === 1 ? '昨日总消息' : `${dayOffset}天前总消息`}
                </span>
                {(() => {
                  // 查看历史日期时用当天学习上限，否则用全局学习上限/手动上限
                  const eq = autoThreshold
                    ? (dayOffset > 0 && dailyLearnedQuota > 0 ? dailyLearnedQuota : learnedQuota)
                    : manualQuota;
                  return eq > 0 ? (
                    <span className="text-[clamp(9px,2vw,11px)] text-slate-400/60 dark:text-[#8e8e93]/50 whitespace-nowrap">
                      / {eq}
                    </span>
                  ) : null;
                })()}
                {(() => {
                  const eq = autoThreshold
                    ? (dayOffset > 0 && dailyLearnedQuota > 0 ? dailyLearnedQuota : learnedQuota)
                    : manualQuota;
                  const cnt = dayOffset > 0 ? hourlyData.reduce((sum, h) => sum + h.messages, 0) : (activeAccount?.total || 0);
                  const isOver = eq > 0 && cnt > eq;
                  const isAlert = !isOver && eq > 0 && cnt >= eq - 5;
                  return isAlert || isOver ? (
                    <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded text-[clamp(9px,2vw,11px)] font-bold border whitespace-nowrap animate-in fade-in slide-in-from-left-2 duration-300 ${
                      isOver
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200/60 dark:border-red-800/40'
                        : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40'
                    }`}>
                      <AlertTriangle size={9} className="shrink-0" />
                      {isOver ? '额度耗尽' : '接近限制'}
                    </span>
                  ) : null;
                })()}
              </div>
            </div>

            {/* 右侧：账号选择 + 自动计数 + 手动补偿 — 响应式宽度，不影响左侧居中 */}
            <div className="text-right flex flex-col items-end gap-1.5 pt-0.5 w-[35%] shrink-0">
              {/* 账号选择 — 宽度与下方计数区域对齐 */}
              <div className="relative w-full" ref={dropdownRef}>
                <button
                  onClick={() => setShowUserDropdown(!showUserDropdown)}
                  className="flex items-center gap-1.5 w-full pl-0 pr-2 py-1 hover:bg-gray-50 dark:hover:bg-white/[0.03] rounded-lg outline-none transition-colors group"
                >
                  <UserAvatar userId={activeAccount?.user_id || ''} avatarUrl={activeAccount?.avatar_url} active={true} size="sm" />
                  <span className="text-[clamp(11px,2.5vw,14px)] font-bold text-slate-700 dark:text-white group-hover:text-blue-600 dark:group-hover:text-[#4daafc] transition-colors truncate min-w-0 flex-1">
                    {activeAccount?.name || '未知用户'}
                  </span>
                  <ChevronDown size={12} className={`text-slate-400 dark:text-gray-500 transition-transform duration-200 shrink-0 ${showUserDropdown ? 'rotate-180 text-blue-500 dark:text-[#4daafc]' : ''}`} />
                </button>

                {showUserDropdown && (
                  <div className="absolute top-[calc(100%+4px)] right-0 w-48 bg-white dark:bg-[#2d2d2d] border border-slate-100 dark:border-[#333] rounded-xl shadow-xl py-1 z-40 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-2 py-1.5 border-b border-slate-50 dark:border-[#333] flex justify-between items-center">
                      <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500">切换账号</span>
                      <div className="flex items-center gap-1">
                        {activeId !== lastActiveUserId && (
                          <button
                            onClick={() => { setIsManualSelect(false); setActiveId(lastActiveUserId || ''); setDayOffset(0); setShowUserDropdown(false); }}
                            className="text-[10px] text-amber-500 dark:text-amber-400 font-bold hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded px-1 -mx-1 flex items-center gap-0.5 transition-colors"
                            title="回到当前正在使用的 Trae 账号"
                          >
                            回到当前 <ArrowRightLeft size={10} />
                          </button>
                        )}
                        <button
                          onClick={() => { setView('all_accounts'); setShowUserDropdown(false); }}
                          className="text-[10px] text-blue-500 dark:text-[#4daafc] font-bold hover:bg-blue-50 dark:hover:bg-[#6e9eff]/10 rounded px-1 -mx-1 flex items-center gap-0.5 transition-colors"
                          title="进入账号管理后，点击头像旁的编辑图标可为账号添加备注"
                        >
                          管理 <Users size={10} />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[calc(100vh-140px)] overflow-y-auto">
                      {mainViewAccounts.map((acc) => (
                        <div
                          key={acc.user_id}
                          onClick={() => { setActiveId(acc.user_id); setShowUserDropdown(false); if (dayOffset > 0) setDayOffset(0); setIsManualSelect(true); }}
                          className="flex items-center justify-between px-2 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.03] cursor-pointer"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <UserAvatar userId={acc.user_id} avatarUrl={acc.avatar_url} active={activeId === acc.user_id} size="sm" />
                            <span className={`text-[11px] font-bold truncate ${activeId === acc.user_id ? 'text-blue-600 dark:text-[#4daafc]' : 'text-slate-600 dark:text-gray-500'}`}>{acc.name}</span>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 dark:text-gray-500 ml-2 pr-2">{acc.total}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 自动/手动数据区 */}
              <div className="flex flex-col gap-1 w-full items-end pr-1">
                <div className="flex items-center justify-between w-full">
                  <span className="text-[clamp(10px,2.2vw,12px)] text-slate-400 dark:text-gray-500 font-medium">系统自动统计</span>
                  <span className="text-[clamp(12px,2.8vw,16px)] font-bold text-slate-700 dark:text-white">{activeAccount?.auto || 0}</span>
                </div>

                {/* 手动补偿 — 步进指示器 + 气泡弹窗 */}
                <div className="relative w-full" ref={manualPopoverRef}>
                  <div
                    onClick={() => { setPopoverValue(String(activeAccount?.manual || 0)); setShowManualPopover(true); }}
                    className="flex items-center justify-between w-full cursor-pointer group">
                    <span className="text-[clamp(10px,2.2vw,12px)] text-blue-400 dark:text-[#4daafc] group-hover:text-blue-500 dark:group-hover:text-[#8ab4ff] transition-all font-medium">手动补偿校准</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[clamp(12px,2.8vw,16px)] font-bold text-blue-600 dark:text-[#4daafc]">{activeAccount?.manual || 0}</span>
                      <span className="w-3.5 h-3.5 rounded-full border border-blue-200/50 dark:border-[#4a4a4c]/50 flex items-center justify-center text-blue-400 dark:text-[#4daafc] group-hover:text-blue-600 dark:group-hover:text-[#8ab4ff] group-hover:border-blue-300 dark:group-hover:border-[#4a4a4c] transition-colors">
                        <Plus size={8} />
                      </span>
                    </div>
                  </div>

                  {showManualPopover && (
                    <div className="absolute top-[calc(100%+6px)] right-0 w-32 bg-white dark:bg-[#2d2d2d] rounded-xl shadow-[0_4px_20px_rgb(0,0,0,0.08)] border border-slate-100 dark:border-[#3a3a3c] p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                      <div className="text-[10px] text-slate-500 dark:text-gray-500 mb-1.5 text-center font-medium">修改补偿值</div>
                      <div className="flex items-stretch gap-1 mb-2">
                        <input
                          type="number"
                          value={popoverValue}
                          onChange={(e) => setPopoverValue(e.target.value)}
                          className="min-w-0 flex-1 bg-gray-50 dark:bg-[#3a3a3c] border border-slate-200 dark:border-[#4a4a4c] rounded-lg px-2 py-1 text-center text-xs font-bold text-blue-600 dark:text-[#4daafc] outline-none focus:border-blue-400 focus:bg-white dark:focus:bg-[#4a4a4c] transition-colors placeholder:text-slate-300 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="0"
                          autoFocus
                          onKeyDown={(e) => { if (e.key === 'Enter') confirmManualPopover(); if (e.key === 'Escape') closeManualPopover(); }}
                        />
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onMouseDown={() => startPopoverLongPress(1)}
                            onMouseUp={stopPopoverLongPress}
                            onMouseLeave={stopPopoverLongPress}
                            className="w-5 h-4 rounded bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] flex items-center justify-center text-slate-600 dark:text-white transition-colors"
                          >
                            <ChevronRight size={10} className="rotate-[-90deg]" />
                          </button>
                          <button
                            onMouseDown={() => startPopoverLongPress(-1)}
                            onMouseUp={stopPopoverLongPress}
                            onMouseLeave={stopPopoverLongPress}
                            className="w-5 h-4 rounded bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] flex items-center justify-center text-slate-600 dark:text-white transition-colors"
                          >
                            <ChevronRight size={10} className="rotate-90" />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={closeManualPopover} className="flex-1 py-1 rounded-lg bg-gray-100 dark:bg-[#3a3a3c] text-slate-500 dark:text-gray-500 text-[10px] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] transition-colors">取消</button>
                        <button onClick={confirmManualPopover} className="flex-1 py-1 rounded-lg bg-blue-600 text-white text-[10px] hover:bg-blue-700 transition-colors">确认</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Chart Section — 悬浮药丸时间切换 */}
          <div className="flex-1 min-h-0 flex flex-col rounded-xl mt-2 relative group/chart" onClick={() => setShowUserDropdown(false)}>
            <div className="flex-1 w-full relative">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400 dark:text-gray-500">暂无数据</div>
              ) : (
                <FluidChart data={chartData} isDark={isDark} />
              )}

              {/* Day navigation buttons — only show in 'day' view */}
              {timeView === 'day' && (
                <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-1 pointer-events-none z-10">
                  <div className="pointer-events-auto">
                    <GlassCircleButton
                      onClick={() => navClick(1)}
                      onMouseDown={() => navLongPressStart(1)}
                      onMouseUp={navLongPressStop}
                      onMouseLeave={navLongPressStop}
                      isDark={isDark}
                      title="前一天"
                      className="opacity-0 group-hover/chart:opacity-100"
                    >
                      <ChevronLeft size={14} className={isDark ? 'text-gray-400' : 'text-slate-500'} />
                    </GlassCircleButton>
                  </div>
                  <div className="pointer-events-auto">
                    <GlassCircleButton
                      onClick={() => navClick(-1)}
                      onMouseDown={() => navLongPressStart(-1)}
                      onMouseUp={navLongPressStop}
                      onMouseLeave={navLongPressStop}
                      isDark={isDark}
                      disabled={dayOffset === 0}
                      title="后一天"
                      className="opacity-0 group-hover/chart:opacity-100"
                    >
                      <ChevronRightIcon size={14} className={isDark ? 'text-gray-400' : 'text-slate-500'} />
                    </GlassCircleButton>
                  </div>
                </div>
              )}
            </div>

            {/* Day offset indicator */}
            {timeView === 'day' && dayOffset > 0 && (
              <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  color: isDark ? '#8e8e93' : '#64748b',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                }}>
                  {dayOffset === 1 ? '昨天' : `${dayOffset}天前`}
                </span>
              </div>
            )}

            {/* 时间切换器 — 悬停图表区域任意位置即可显示 */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 opacity-0 group-hover/chart:opacity-100 transition-opacity duration-300 pointer-events-none group-hover/chart:pointer-events-auto">
              <TimeSwitcher timeView={timeView} setTimeView={setTimeView} isDark={isDark} />
            </div>
          </div>
        </div>
        )}

        {/* All Accounts Management View */}
        {view === 'all_accounts' && (
        <div className="absolute inset-0 bg-white dark:bg-[#252526] flex flex-col z-20 animate-in slide-in-from-right-4 duration-200">
          <div className="h-11 px-3 flex items-center justify-between bg-white dark:bg-[#252526] shrink-0 border-b border-gray-100 dark:border-[#333]">
            <div className="flex items-center gap-2">
              <button onClick={() => setView('main')} className="text-slate-500 dark:text-gray-500 hover:text-slate-700 dark:hover:text-[#e5e5e5] transition-colors outline-none">
                <ArrowLeft size={16} />
              </button>
              <span className="text-sm font-bold text-slate-800 dark:text-white">账号管理</span>
              <div className="relative group/info">
                <Info size={14} className="text-slate-400 dark:text-gray-500 cursor-help" />
                <div className="absolute left-6 top-full mt-1 w-60 opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all duration-200 z-[9999] pointer-events-none">
                  <div className="bg-white dark:bg-[#3a3a3c] border border-slate-200 dark:border-[#4a4a4c] rounded-lg shadow-xl p-3 text-[11px] text-slate-600 dark:text-gray-300 space-y-1.5">
                    <p className="font-semibold text-slate-700 dark:text-white mb-1">功能说明</p>
                    <p><b>备注</b> — 悬停点击头像编辑图标，为账号添加自定义备注</p>
                    <p><b>切换</b> — 切换 Trae 当前登录的账号（会自动快照保存凭证）</p>
                    <p><b>拍快照</b> — 保存当前 Trae 登录凭证到本地，用于后续免登录切换</p>
                    <p><b>删快照</b> — 删除已保存的登录凭证，下次切换需重新在 Trae 中登录</p>
                    <p><b>删除</b> — 彻底移除该用户的所有计数记录和凭证数据</p>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={toggleSort} className="text-[11px] flex items-center gap-1 text-slate-500 dark:text-gray-500 hover:text-blue-600 dark:hover:text-[#6e9eff] transition-colors outline-none">
              <ArrowUpDown size={12} />
              {sortBy === 'active' ? '活跃优先' : '数量排序'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {allViewAccounts.map((acc, index) => (
              <div key={acc.user_id} className="border-b border-gray-100 dark:border-[#333] last:border-0 flex flex-col transition-colors">
                <div
                  className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
                  onClick={() => {
                    if (editingRemarkId === acc.user_id) return;
                    setExpandedId(expandedId === acc.user_id ? null : acc.user_id);
                  }}
                >
                  <div className="relative shrink-0 group/avatar">
                    <UserAvatar userId={acc.user_id} avatarUrl={acc.avatar_url} active={acc.is_tracking} size="sm" />
                    {accounts.length > 1 && (
                      <div className="absolute -top-1 -left-1 w-4 h-4 bg-[#007acc] dark:bg-[#007acc] text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-[#252526]">
                        {index + 1}
                      </div>
                    )}
                    {/* 头像悬停显示编辑备注图标 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingRemarkId(acc.user_id);
                        setRemarkValue(acc.remark || '');
                      }}
                      className="absolute inset-0 rounded-full bg-black/40 dark:bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
                      title={acc.remark ? '修改备注' : '添加备注'}
                    >
                      <Edit2 size={14} className="text-white drop-shadow-sm" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingRemarkId === acc.user_id ? (
                      <div className="flex items-center gap-1 h-6" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={remarkValue}
                          onChange={(e) => setRemarkValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation();
                              if ((window as any)?.go?.main?.App) {
                                (window as any).go.main.App.SetUserRemark(acc.user_id, remarkValue.trim()).then(() => {
                                  refreshData();
                                  setEditingRemarkId(null);
                                  setRemarkValue('');
                                });
                              }
                            }
                            if (e.key === 'Escape') {
                              e.stopPropagation();
                              setEditingRemarkId(null);
                              setRemarkValue('');
                            }
                          }}
                          className="flex-1 bg-white dark:bg-[#3c3c3c] border border-blue-500 dark:border-[#007acc] text-gray-900 dark:text-white text-sm px-1.5 py-0.5 rounded outline-none w-full min-w-0 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                          placeholder="添加备注..."
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((window as any)?.go?.main?.App) {
                              (window as any).go.main.App.SetUserRemark(acc.user_id, remarkValue.trim()).then(() => {
                                refreshData();
                                setEditingRemarkId(null);
                                setRemarkValue('');
                              });
                            }
                          }}
                          className="p-1 text-green-600 dark:text-green-400 hover:bg-gray-200 dark:hover:bg-white/10 rounded"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingRemarkId(null);
                            setRemarkValue('');
                          }}
                          className="p-1 text-red-500 dark:text-red-400 hover:bg-gray-200 dark:hover:bg-white/10 rounded"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 h-6">
                        <span className={`truncate text-sm font-medium cursor-text select-text transition-colors ${acc.remark ? 'text-gray-900 dark:text-white' : 'text-gray-800 dark:text-gray-200'}`} title={acc.remark || acc.name}>
                          {acc.remark || acc.name}
                        </span>
                      </div>
                    )}
                    <span className="block text-[11px] text-gray-500 dark:text-[#999999] truncate leading-tight cursor-text select-text transition-colors" title={acc.remark
                      ? `${acc.name} · ${acc.user_id}`
                      : acc.user_id
                    }>
                      {acc.remark
                        ? `${acc.name} · ${acc.user_id}`
                        : acc.user_id
                      }
                    </span>
                  </div>
                  <span className="text-base font-bold text-gray-900 dark:text-white shrink-0 transition-colors">{acc.total}</span>
                  <ChevronRight size={14} className={`text-gray-400 dark:text-gray-500 transition-transform duration-200 shrink-0 ${expandedId === acc.user_id ? 'rotate-90' : ''}`} />
                </div>

                {expandedId === acc.user_id && (
                  <div className="bg-gray-50 dark:bg-black/20 p-3 pt-2 flex flex-col gap-2 shadow-inner border-t border-gray-100 dark:border-transparent transition-colors">
                    {/* 第一行：日期信息 */}
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-[#cccccc] transition-colors">
                      <span>最后活跃: <span className="text-gray-700 dark:text-[#ececec]">{acc.last_active || '未知'}</span></span>
                      <span>首次记录: <span className="text-gray-700 dark:text-[#ececec]">{acc.first_seen || '未知'}</span></span>
                    </div>
                    {acc.learned_quota > 0 && (
                      <div className="text-[11px] text-gray-500 dark:text-[#cccccc] transition-colors">
                        学习上限: <span className="text-[#007acc] dark:text-[#4daafc] font-bold">{acc.learned_quota}</span>
                        <span className="ml-2 opacity-50">提醒 {acc.learned_quota - 10} / 警告 {acc.learned_quota - 5}</span>
                      </div>
                    )}
                    {/* 第二行：统计与操作按钮 */}
                    <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
                      <div className="text-xs text-gray-500 dark:text-[#cccccc] transition-colors">
                        自动: <span className="text-gray-800 dark:text-white font-bold">{acc.auto}</span>
                        <span className="mx-2 opacity-30">|</span>
                        手动: <span className="text-[#007acc] dark:text-[#4daafc] font-bold">{acc.manual}</span>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto justify-end flex-1">
                        {/* Snapshot button */}
                        {snapshotStatus[acc.user_id] ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSnapshotConfirmId({ userId: acc.user_id, action: 'delete' });
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-xs rounded transition-colors whitespace-nowrap border border-amber-200 dark:border-amber-500/20 shadow-sm dark:shadow-none"
                            title="删除已保存的凭证快照"
                          >
                            <CameraOff size={12} /> 删快照
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSnapshotConfirmId({ userId: acc.user_id, action: 'take' });
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-50 dark:bg-green-500/10 hover:bg-green-100 dark:hover:bg-green-500/20 text-green-600 dark:text-green-400 text-xs rounded transition-colors whitespace-nowrap border border-green-200 dark:border-green-500/20 shadow-sm dark:shadow-none"
                            title="保存当前 Trae 登录凭证到此账号（需先在 Trae 中登录此账号）"
                          >
                            <Camera size={12} /> 拍快照
                          </button>
                        )}
                        {currentTraeUserId === acc.user_id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSwitchMessage('已经是当前正在使用的账号'); setTimeout(() => setSwitchMessage(null), 2000); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-[#2a2a2a] text-gray-400 dark:text-[#666] text-xs rounded cursor-default whitespace-nowrap border border-gray-200 dark:border-transparent"
                          >
                            <Check size={12} /> 当前
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSwitchConfirmId(acc.user_id); setSwitchMessage(null); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-[#3a3d41] hover:bg-gray-200 dark:hover:bg-[#4a4d51] text-gray-700 dark:text-[#cccccc] text-xs rounded transition-colors whitespace-nowrap border border-gray-200 dark:border-transparent shadow-sm dark:shadow-none"
                          >
                            <ArrowRightLeft size={12} /> 切换
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(acc.user_id); }}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 text-xs rounded transition-colors whitespace-nowrap border border-red-200 dark:border-red-500/20 shadow-sm dark:shadow-none"
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>

      {/* Manual Adjustment Modal */}
      {manualModal.show && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 dark:bg-[#000000]/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={closeManualModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#2d2d2d] w-[340px] rounded-[24px] shadow-2xl border border-slate-100 dark:border-[#333] p-6 flex flex-col animate-in zoom-in-95 duration-200"
          >
            <div className="flex justify-between items-center mb-5">
              <span className="font-bold text-slate-800 dark:text-white text-lg">校准数据</span>
              <button onClick={closeManualModal} className="text-slate-400 hover:text-slate-700 bg-gray-50 dark:bg-[#3a3a3c] hover:bg-gray-100 dark:hover:bg-[#4a4a4c] border border-slate-100 dark:border-[#4a4a4c] rounded-full p-2 transition-colors">
                <X size={14} />
              </button>
            </div>

            <div className="text-xs text-slate-500 dark:text-[#8e8e93] mb-6 bg-gray-50 dark:bg-[#1e1e1e] p-3.5 rounded-xl flex justify-between items-center border border-slate-200/60 dark:border-[#3a3a3c] shadow-inner">
              <span className="truncate pr-2 font-medium">当前账号: <strong className="text-slate-700 dark:text-white">{activeAccount?.name || '未知'}</strong></span>
              <span className="shrink-0 text-blue-600 dark:text-[#4daafc] font-bold bg-blue-50 dark:bg-[#6e9eff]/10 px-2 py-1 rounded-md">原补偿: {activeAccount?.manual || 0}</span>
            </div>

            <div className="flex flex-col items-center justify-center mb-8">
              <span className="text-[11px] text-slate-400 dark:text-[#8e8e93] font-bold tracking-widest uppercase mb-4">设定调整增量</span>
              <div className="flex items-center gap-5">
                <button
                  onMouseDown={() => startLongPress(-1)}
                  onMouseUp={stopLongPress}
                  onMouseLeave={stopLongPress}
                  onTouchStart={() => startLongPress(-1)}
                  onTouchEnd={stopLongPress}
                  className="w-12 h-12 rounded-full bg-white dark:bg-[#3a3d41] border-2 border-slate-100 dark:border-[#3a3a3c] text-slate-600 dark:text-white flex items-center justify-center hover:border-amber-300 hover:text-amber-500 hover:bg-amber-50 active:scale-95 transition-all shadow-sm select-none"
                >
                  <Minus size={20} />
                </button>

                <div className="w-24 text-center">
                  <div className={`text-5xl font-black tracking-tighter ${
                    manualModal.delta > 0 ? 'text-blue-600 dark:text-[#4daafc]' :
                    manualModal.delta < 0 ? 'text-amber-500 dark:text-[#ffb340]' : 'text-slate-300 dark:text-[#3a3a3c]'
                  }`}>
                    {manualModal.delta > 0 ? `+${manualModal.delta}` : manualModal.delta === 0 ? '+0' : manualModal.delta}
                  </div>
                </div>

                <button
                  onMouseDown={() => startLongPress(1)}
                  onMouseUp={stopLongPress}
                  onMouseLeave={stopLongPress}
                  onTouchStart={() => startLongPress(1)}
                  onTouchEnd={stopLongPress}
                  className="w-12 h-12 rounded-full bg-white dark:bg-[#3a3d41] border-2 border-slate-100 dark:border-[#3a3a3c] text-slate-600 dark:text-white flex items-center justify-center hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 active:scale-95 transition-all shadow-sm select-none"
                >
                  <Plus size={20} />
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-2">
              <button onClick={closeManualModal} className="flex-1 py-3.5 rounded-xl font-bold text-sm text-slate-600 dark:text-gray-500 bg-white dark:bg-[#3a3d41] border-2 border-slate-100 dark:border-[#3a3a3c] hover:bg-gray-50 hover:border-slate-200 transition-all">取消</button>
              <button onClick={confirmManualAdjust} className="flex-1 py-3.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-blue-500/30">
                确认校准
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Confirm Modal */}
      {snapshotConfirmId && (() => {
        const snapAcc = accounts.find(a => a.user_id === snapshotConfirmId.userId);
        const isDelete = snapshotConfirmId.action === 'delete';
        const isCurrentUser = currentTraeUserId === snapshotConfirmId.userId;
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 dark:bg-[#000000]/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setSnapshotConfirmId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#2d2d2d] w-[300px] rounded-2xl shadow-2xl border border-slate-100 dark:border-[#333] p-5 flex flex-col animate-in zoom-in-95 duration-200"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isDelete ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
                  {isDelete ? <CameraOff size={16} className="text-amber-500" /> : <Camera size={16} className="text-green-500" />}
                </div>
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-sm">{isDelete ? '删除快照' : '拍快照'}</p>
                  <p className="text-[11px] text-slate-400 dark:text-[#8e8e93] mt-0.5">{snapAcc?.name || snapshotConfirmId.userId}</p>
                </div>
              </div>
              {isDelete ? (
                <p className="text-xs text-slate-500 dark:text-[#8e8e93] mb-4">
                  确定删除该账号的凭证快照？删除后切换到该账号将需要重新在 Trae 中登录。此操作不可撤销。
                </p>
              ) : (
                <div className="text-xs text-slate-500 dark:text-[#8e8e93] mb-4 space-y-1.5">
                  <p>将保存当前 Trae 登录凭证到此账号，用于后续切换。</p>
                  {!isCurrentUser && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40">
                      当前 Trae 登录的不是此账号，拍快照会失败。请先在 Trae 中登录此账号。
                    </div>
                  )}
                  {isCurrentUser && (
                    <div className="px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-200/60 dark:border-green-800/40">
                      当前 Trae 已登录此账号，可以正常拍快照。
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setSnapshotConfirmId(null)}
                  className="flex-1 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-[#8e8e93] bg-gray-50 dark:bg-[#3a3d41] hover:bg-gray-100 dark:hover:bg-[#4a4a4c] transition-all"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    try {
                      if ((window as any)?.go?.main?.App) {
                        if (isDelete) {
                          await (window as any).go.main.App.DeleteSnapshot(snapshotConfirmId.userId);
                          setSnapshotStatus(prev => ({ ...prev, [snapshotConfirmId.userId]: false }));
                          setSnapshotMessage(`已删除 ${snapAcc?.name || snapshotConfirmId.userId} 的快照`);
                        } else {
                          await (window as any).go.main.App.SnapshotForUser(snapshotConfirmId.userId);
                          setSnapshotStatus(prev => ({ ...prev, [snapshotConfirmId.userId]: true }));
                          setSnapshotMessage(`已保存 ${snapAcc?.name || snapshotConfirmId.userId} 的快照`);
                        }
                        setTimeout(() => setSnapshotMessage(null), 2000);
                      }
                    } catch (err: any) {
                      setSnapshotMessage(err?.message || (isDelete ? '删除快照失败' : '拍快照失败'));
                      setTimeout(() => setSnapshotMessage(null), 3000);
                    }
                    setSnapshotConfirmId(null);
                  }}
                  className={`flex-1 py-2 rounded-xl font-bold text-sm text-white transition-all shadow-lg ${
                    isDelete
                      ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'
                      : 'bg-green-500 hover:bg-green-600 shadow-green-500/20'
                  }`}
                >
                  {isDelete ? '确认删除' : '确认拍快照'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete User Confirm Modal */}
      {deleteConfirmId && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 dark:bg-[#000000]/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#2d2d2d] w-[280px] rounded-2xl shadow-2xl border border-slate-100 dark:border-[#333] p-5 flex flex-col animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                <Trash2 size={16} className="text-red-500" />
              </div>
              <div>
                <p className="font-bold text-slate-800 dark:text-white text-sm">删除用户</p>
                <p className="text-[11px] text-slate-400 dark:text-[#8e8e93] mt-0.5">此操作不可撤销</p>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-[#8e8e93] mb-4">
              确定要删除该用户的所有数据吗？如果该用户后续有新的对话提交，会自动重新出现。
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2 rounded-xl font-bold text-sm text-slate-600 dark:text-[#8e8e93] bg-gray-50 dark:bg-[#3a3d41] hover:bg-gray-100 dark:hover:bg-[#4a4a4c] transition-all"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteUser(deleteConfirmId)}
                className="flex-1 py-2 rounded-xl font-bold text-sm text-white bg-red-500 hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Switch User Confirm Modal */}
      {switchConfirmId && (() => {
        const switchAcc = accounts.find(a => a.user_id === switchConfirmId);
        const isSuccess = switchMessage?.includes('正在切换');
        const isNoCred = switchMessage?.includes('无本地凭证');
        return (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/30 dark:bg-[#000000]/50 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => { if (!isSwitching) { setSwitchConfirmId(null); setSwitchMessage(null); } }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#2d2d2d] w-[240px] rounded-xl shadow-2xl border border-slate-100 dark:border-[#333] p-4 flex flex-col animate-in zoom-in-95 duration-200"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                  <ArrowRightLeft size={14} className="text-blue-500" />
                </div>
                <div>
                  <p className="font-bold text-slate-800 dark:text-white text-sm">切换用户</p>
                </div>
              </div>
              {!switchMessage && (
                <p className="text-xs text-slate-500 dark:text-[#8e8e93] mb-3">
                  确定切换到用户 {switchAcc?.name || switchConfirmId}？当前用户凭证将被备份保存。
                </p>
              )}
              {switchMessage && (
                <div className={`text-xs mb-3 px-2.5 py-1.5 rounded-lg ${
                  isSuccess
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                }`}>
                  {switchMessage}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setSwitchConfirmId(null); setSwitchMessage(null); }}
                  disabled={isSwitching}
                  className="flex-1 py-1.5 rounded-lg font-bold text-xs text-slate-600 dark:text-gray-500 bg-gray-50 dark:bg-[#3a3a3c] hover:bg-gray-100 dark:hover:bg-[#4a4a4c] transition-all disabled:opacity-50"
                >
                  {isSuccess ? '取消' : isNoCred ? '取消' : '取消'}
                </button>
                <button
                  onClick={async () => {
                    if (isSwitching) return;
                    if (isSuccess) {
                      // Backend already handles reopening Trae, just close the dialog
                      setSwitchConfirmId(null);
                      setSwitchMessage(null);
                      return;
                    }
                    if (isNoCred) {
                      setSwitchConfirmId(null);
                      setSwitchMessage(null);
                      return;
                    }
                    setIsSwitching(true);
                    setSwitchMessage(null);
                    // Immediately switch to target user and show loading state
                    setActiveId(switchConfirmId);
                    setIsUserSwitching(true);
                    setWeekHistory([]);
                    setMonthHistory([]);
                    setYearHistory([]);
                    setHourlyData([]);
                    try {
                      if ((window as any)?.go?.main?.App) {
                        await (window as any).go.main.App.SwitchUser(switchConfirmId);
                        setSwitchMessage('正在切换，等待 Trae IDE 重启验证...');
                        setIsSwitching(false);
                        // Don't set currentTraeUserId here — wait for the
                        // currentUserChanged event from the backend, which
                        // verifies the actual user after Trae restarts.
                        // Reset to today and refresh data after delay
                        setDayOffset(0);
                        setTimeout(() => {
                          setIsUserSwitching(false);
                          refreshData();
                          setSwitchConfirmId(null);
                          setSwitchMessage(null);
                        }, 8000);
                      }
                    } catch (e: any) {
                      setSwitchMessage(e?.message || String(e) || '切换失败');
                      setIsSwitching(false);
                      setIsUserSwitching(false);
                    }
                  }}
                  disabled={isSwitching}
                  className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition-all disabled:opacity-50 ${
                    isSuccess
                      ? 'text-white bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/20'
                      : isNoCred
                        ? 'text-white bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20'
                        : 'text-white bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20'
                  }`}
                >
                  {isSwitching ? '切换中...' : isSuccess ? '完成' : isNoCred ? '知道了' : '确认切换'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Snapshot Message Toast */}
      {snapshotMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className={`px-4 py-2 rounded-xl text-xs font-medium shadow-xl border ${
            snapshotMessage.includes('失败') || snapshotMessage.includes('错误')
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/40'
              : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800/40'
          }`}>
            {snapshotMessage}
          </div>
        </div>
      )}

      {/* Settings Dropdown Panel */}
      {showSettings && (
        <div
          ref={settingsRef}
          className="absolute top-[42px] right-3 z-50 bg-white dark:bg-[#2d2d2d] w-[260px] max-h-[calc(100vh-60px)] overflow-y-auto rounded-xl shadow-xl border border-slate-100 dark:border-[#3a3a3c] p-2.5 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {/* 仅状态栏显示 */}
          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">仅状态栏显示</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">隐藏 Dock 图标，仅保留菜单栏</span>
            </div>
            <button
              onClick={async () => {
                const newVal = !dockHidden;
                if ((window as any)?.go?.main?.App) {
                  await (window as any).go.main.App.SetDockHidden(newVal);
                  setDockHidden(newVal);
                }
              }}
              className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${dockHidden ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${dockHidden ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* 开机自启动 */}
          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">开机自启动</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">登录时自动在后台启动</span>
            </div>
            <button
              onClick={async () => {
                const newVal = !autoLaunch;
                if ((window as any)?.go?.main?.App) {
                  await (window as any).go.main.App.SetAutoLaunch(newVal);
                  setAutoLaunch(newVal);
                }
              }}
              className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${autoLaunch ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${autoLaunch ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* 阈值通知 */}
          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">阈值通知</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">达到提醒/警告阈值时发送通知</span>
            </div>
            <button
              onClick={async () => {
                const newVal = !notifyEnabled;
                if ((window as any)?.go?.main?.App) {
                  await (window as any).go.main.App.SetNotifyEnabled(newVal);
                  setNotifyEnabled(newVal);
                }
              }}
              className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${notifyEnabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${notifyEnabled ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">固定到 Control Strip</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">在 Touch Bar 右侧固定显示图标</span>
            </div>
            <button
                onClick={toggleControlStrip}
                className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${controlStripPinned ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
              >
                <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${controlStripPinned ? 'translate-x-[16px]' : 'translate-x-0'}`} />
              </button>
          </div>
          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">外观主题</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">跟随系统或手动切换</span>
            </div>
            <div className="flex items-center bg-gray-100 dark:bg-[#3a3a3c] rounded-lg p-0.5">
              {[
                { key: 'system', label: '自动' },
                { key: 'light', label: '浅色' },
                { key: 'dark', label: '深色' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => changeTheme(opt.key)}
                  className={`px-2 py-0.5 text-[10px] rounded-md transition-all ${
                    theme === opt.key
                      ? 'bg-white dark:bg-[#4a4a4c] text-blue-600 dark:text-[#4daafc] shadow-sm font-semibold'
                      : 'text-slate-500 dark:text-gray-500 hover:text-slate-700 dark:hover:text-[#e5e5e5] font-medium'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Show All Accounts */}
          <div className="flex items-center justify-between py-1 px-0.5 border-t border-slate-100 dark:border-[#3a3a3c] mt-1 pt-1.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">显示全部账号</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">在下拉菜单中显示当天无数据的账号</span>
            </div>
            <button
              onClick={async () => {
                const newVal = !showAllAccounts;
                if ((window as any)?.go?.main?.App) {
                  await (window as any).go.main.App.SetShowAllAccounts(newVal);
                }
                setShowAllAccounts(newVal);
              }}
              className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${showAllAccounts ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${showAllAccounts ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Smart Threshold */}
          <div className="flex items-center justify-between py-1 px-0.5 border-t border-slate-100 dark:border-[#3a3a3c] mt-1 pt-1.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">智能阈值</span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">
                {autoThreshold
                  ? learnedQuota > 0
                    ? `根据学习上限 ${learnedQuota} 自动调整`
                    : '等待学习额度上限...'
                  : '根据学习到的额度上限自动调整阈值'}
              </span>
            </div>
            <button
              onClick={async () => {
                const newVal = !autoThreshold;
                if ((window as any)?.go?.main?.App) {
                  await (window as any).go.main.App.SetAutoThreshold(newVal);
                  setAutoThreshold(newVal);
                  if (newVal) {
                    // Immediately apply learned quota
                    const wt = await (window as any).go.main.App.GetWarningThreshold();
                    const at = await (window as any).go.main.App.GetAlertThreshold();
                    setWarningThreshold(wt);
                    setAlertThreshold(at);
                  }
                }
              }}
              className={`relative w-[36px] h-[20px] rounded-full transition-colors duration-200 shrink-0 ${autoThreshold ? 'bg-blue-500' : 'bg-slate-300 dark:bg-[#4a4a4c]'}`}
            >
              <span className={`absolute top-[2px] left-[2px] w-[16px] h-[16px] bg-white rounded-full shadow-sm transition-transform duration-200 ${autoThreshold ? 'translate-x-[16px]' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Manual Quota Input (shown when smart threshold is off) */}
          {!autoThreshold && (
            <div className="flex items-center justify-between py-1 px-0.5">
              <div className="flex flex-col">
                <span className="text-[12px] font-medium text-slate-700 dark:text-white">额度上限</span>
                <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">用于大数字变色和折线图红线</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const v = Math.max(1, manualQuota - 5);
                    setManualQuota(v);
                    if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetManualQuota(v);
                  }}
                  className="w-5 h-5 rounded bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] flex items-center justify-center text-slate-600 dark:text-white transition-colors"
                >
                  <Minus size={10} />
                </button>
                <span className="w-7 text-center text-[12px] font-bold text-blue-600 dark:text-[#4daafc]">{manualQuota}</span>
                <button
                  onClick={() => {
                    const v = manualQuota + 5;
                    setManualQuota(v);
                    if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetManualQuota(v);
                  }}
                  className="w-5 h-5 rounded bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] flex items-center justify-center text-slate-600 dark:text-white transition-colors"
                >
                  <Plus size={10} />
                </button>
              </div>
            </div>
          )}

          {/* Warning Threshold Setting */}
          <div className="flex items-center justify-between py-1 px-0.5 border-t border-slate-100 dark:border-[#3a3a3c] mt-1 pt-1.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">
                提醒阈值
                {autoThreshold && <span className="ml-1 text-[9px] text-blue-500 dark:text-[#4daafc] font-normal">自动</span>}
              </span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">
                {autoThreshold ? `学习上限 ${learnedQuota || '?'} - 10` : '达到此数值显示黄色提醒'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (autoThreshold) return;
                  const v = Math.max(10, warningThreshold - 5);
                  setWarningThreshold(v);
                  if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetWarningThreshold(v);
                }}
                disabled={autoThreshold}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${autoThreshold ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] text-slate-600 dark:text-white'}`}
              >
                <Minus size={10} />
              </button>
              <span className="w-7 text-center text-[12px] font-bold text-amber-600 dark:text-amber-400">{warningThreshold}</span>
              <button
                onClick={() => {
                  if (autoThreshold) return;
                  const v = Math.min(alertThreshold - 5, warningThreshold + 5);
                  setWarningThreshold(v);
                  if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetWarningThreshold(v);
                }}
                disabled={autoThreshold}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${autoThreshold ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] text-slate-600 dark:text-white'}`}
              >
                <Plus size={10} />
              </button>
            </div>
          </div>

          {/* Alert Threshold Setting */}
          <div className="flex items-center justify-between py-1 px-0.5">
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-slate-700 dark:text-white">
                警告阈值
                {autoThreshold && <span className="ml-1 text-[9px] text-blue-500 dark:text-[#4daafc] font-normal">自动</span>}
              </span>
              <span className="text-[9px] text-slate-400 dark:text-gray-500 mt-0.5">
                {autoThreshold ? `学习上限 ${learnedQuota || '?'} - 5` : '达到此数值显示红色警告'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (autoThreshold) return;
                  const v = Math.max(warningThreshold + 5, alertThreshold - 5);
                  setAlertThreshold(v);
                  if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetAlertThreshold(v);
                }}
                disabled={autoThreshold}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${autoThreshold ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] text-slate-600 dark:text-white'}`}
              >
                <Minus size={10} />
              </button>
              <span className="w-7 text-center text-[12px] font-bold text-red-600 dark:text-red-400">{alertThreshold}</span>
              <button
                onClick={() => {
                  if (autoThreshold) return;
                  const v = Math.min(100, alertThreshold + 5);
                  setAlertThreshold(v);
                  if ((window as any)?.go?.main?.App) (window as any).go.main.App.SetAlertThreshold(v);
                }}
                disabled={autoThreshold}
                className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${autoThreshold ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'bg-gray-100 dark:bg-[#3a3a3c] hover:bg-gray-200 dark:hover:bg-[#4a4a4c] text-slate-600 dark:text-white'}`}
              >
                <Plus size={10} />
              </button>
            </div>
          </div>

          {/* Quota Info */}
          {quotaInfo && (
            <div className={`mt-1 pt-1.5 border-t border-slate-100 dark:border-[#3a3a3c] px-1 py-1 rounded-lg text-[10px] ${
              quotaInfo.is_exhausted
                ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400'
                : 'bg-gray-50 dark:bg-[#3a3a3c] text-slate-500 dark:text-gray-500'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {quotaInfo.is_exhausted ? '额度已耗尽' : `今日: ${activeAccount?.total ?? 0} / 上限: ${quotaInfo.quota}`}
                </span>
                <span className="text-[9px] opacity-70">{quotaInfo.identity_str || 'Free'}</span>
              </div>
              {quotaInfo.fast_request_per > 0 && (
                <div className="mt-0.5 text-[10px] opacity-80">
                  快速请求剩余: {quotaInfo.fast_request_per}
                </div>
              )}
              {quotaInfo.is_exhausted && quotaInfo.exhaust_source && (
                <div className="mt-0.5 text-[10px] opacity-80">
                  检测来源: {quotaInfo.exhaust_source === 'storage' ? 'storage.json' : quotaInfo.exhaust_source === 'renderer_log' ? '渲染日志' : quotaInfo.exhaust_source === '4031_log' ? '4031错误' : quotaInfo.exhaust_source}
                </div>
              )}
              {learnedQuota > 0 && (
                <div className="mt-0.5 text-[10px] opacity-80">
                  学习上限: {learnedQuota} {autoThreshold ? '(已启用智能阈值)' : ''}
                </div>
              )}
              {quotaInfo.is_exhausted && quotaInfo.next_flash > 0 && (
                <div className="mt-0.5 text-[10px] opacity-80">
                  重置时间: {new Date(quotaInfo.next_flash).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}

          {/* Restart Button */}
          <div className="border-t border-slate-100 dark:border-[#3a3a3c] mt-1 pt-1.5 px-1">
            <button
              onClick={() => {
                if ((window as any)?.go?.main?.App) {
                  (window as any).go.main.App.RestartApp();
                }
              }}
              className="w-full py-2 rounded-lg text-[11px] font-semibold text-slate-500 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-[#3a3a3c] hover:text-slate-700 dark:hover:text-white transition-colors flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={11} />
              重启应用
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
