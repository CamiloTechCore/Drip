import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  X,
  Droplets,
  Inbox,
  CloudUpload,
  ArrowDownLeft,
  ArrowUpRight,
  Coffee,
  Home,
  ShoppingBag,
  Car,
  Heart,
  Banknote,
  Wallet,
  Zap,
  GraduationCap,
  Clapperboard,
  Shirt,
  PiggyBank,
} from "lucide-react";
import { isSavingsDeposit, isSavingsWithdrawal } from "../lib/analytics";
import { money } from "../lib/format";
import type { Categoria, Registro } from "../types";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width="48" height="48" />
      </span>
      drip<span className="brand-dot">.</span>
    </span>
  );
}
export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return <section className={`card ${className}`} onClick={onClick}>{children}</section>;
}
export function Empty({
  title = "Todavía no hay movimientos",
  text = "Cada pequeño registro te ayuda a ver el panorama completo.",
  children,
}: {
  title?: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Amount({
  value,
  currency = "COP",
}: {
  value: number;
  currency?: string;
}) {
  const [shown, setShown] = useState(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const control = animate(shown, value, {
      duration: 0.55,
      onUpdate: setShown,
    });
    return control.stop; /* animate from the previous display value */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);
  return <>{money(shown, currency)}</>;
}
export function SectionTitle({
  title,
  children,
  eyebrow,
}: {
  title: string;
  children?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const label = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current
    )?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const list = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label}
        className="sheet"
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          className="sheet-handle"
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 65) onClose();
          }}
          aria-hidden="true"
        >
          <span />
        </motion.div>
        <div className="sheet-heading">
          <h2 id={label}>{title}</h2>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
export const categoryIcons: Record<string, typeof Wallet> = {
  Wallet,
  Coffee,
  Home,
  ShoppingBag,
  Car,
  Heart,
  Banknote,
  Zap,
  GraduationCap,
  Clapperboard,
  Shirt,
  PiggyBank,
  Droplets,
  House: Home,
  ShoppingBasket: ShoppingBag,
  Utensils: Coffee,
  Bus: Car,
  HeartPulse: Heart,
  Gamepad2: Clapperboard,
  Repeat: Zap,
  CreditCard: Wallet,
  CircleEllipsis: Wallet,
  Sparkles: Droplets,
};
export function CategoryIcon({ category }: { category?: Categoria }) {
  const Icon = categoryIcons[category?.icono ?? ""] ?? Wallet;
  return (
    <span
      className="category-icon"
      style={{
        color: category?.color ?? "#5551E8",
        background: `${category?.color ?? "#5551E8"}12`,
      }}
    >
      <Icon size={20} />
    </span>
  );
}
export function RecordRow({
  record,
  categories,
  currency,
  pending,
  onClick,
}: {
  record: Registro;
  categories: Categoria[];
  currency: string;
  pending?: boolean;
  onClick?: () => void;
}) {
  const income = record.tipo === "ingreso";
  const savingsLabel = isSavingsDeposit(record) ? "Aporte de ahorro" : isSavingsWithdrawal(record) ? "Retiro de ahorro" : "";
  return (
    <button
      className="record-row"
      onClick={onClick}
      aria-label={`${record.descripcion || record.categoria}, ${money(record.monto, currency)}. Editar movimiento`}
    >
      <CategoryIcon
        category={categories.find((c) => c.nombre === record.categoria)}
      />
      <span className="record-copy">
        <strong>
          {record.tipo === "sin_gasto"
            ? "Hoy no gasté"
            : record.descripcion || record.categoria || "Movimiento"}
        </strong>
        <span>
          {savingsLabel || record.categoria || "Un paso hacia tu meta"}
          {pending && (
            <CloudUpload size={13} aria-label="Pendiente de sincronizar" />
          )}
        </span>
      </span>
      <span className={`record-amount ${income ? "positive" : ""}`}>
        {income ? "+" : record.tipo === "sin_gasto" ? "" : "−"}
        {money(record.monto, currency)}
      </span>
    </button>
  );
}
export function MoneyStat({
  label,
  value,
  currency,
  income = false,
}: {
  label: string;
  value: number;
  currency: string;
  income?: boolean;
}) {
  return (
    <div className="money-stat">
      <span className={`stat-icon ${income ? "income" : "expense"}`}>
        {income ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </span>
      <div>
        <span>{label}</span>
        <strong>{money(value, currency)}</strong>
      </div>
    </div>
  );
}
