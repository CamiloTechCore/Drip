import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Flame,
  Leaf,
  Share2,
  Sparkles,
  Wallet,
  CalendarClock,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useDrip } from "../context";
import {
  getAntExpenses,
  getCycles,
  getTotals,
  getDebtSummary,
  getStreaks,
  todayISO,
  addDays,
  daysBetween,
} from "../lib/analytics";
import { money } from "../lib/format";
import { Amount, Card, Empty, RecordRow, SectionTitle } from "../components/ui";
import { CashChart } from "../components/Charts";
import SavingsCard from "../components/SavingsCard";
export default function Home() {
  const { data, add, share, pendingIds } = useDrip();
  const { registros, config, categorias } = data;
  const today = todayISO();
  const records = registros.filter((r) => !r.eliminado && r.fecha <= today);
  const cycles = getCycles(records, config, today);
  const current =
    cycles.find((c) => c.start <= today && c.end >= today) ?? cycles.at(-1);
  const streak = getStreaks(records, config, today);
  const ants = getAntExpenses(records, config, today);
  const previousAnts = getAntExpenses(records, config, addDays(today, -30));
  const antGrowth = previousAnts.total > 0 ? (ants.total - previousAnts.total) / previousAnts.total * 100 : null;
  const debt = getDebtSummary(data.deudas, records, today);
  const upcoming = data.recurrentes
    .filter((r) => r.activa)
    .sort((a, b) => a.proximo_pago.localeCompare(b.proximo_pago))[0];
  const hasData = records.length > 0;
  const currency = config.moneda;
  const totals = getTotals(records);
  const income = totals.income, expenses = totals.expenses;
  // Payments are already included in cycle expenses; never subtract them twice.
  const available = totals.available;
  return (
    <div className="page home-page">
      <div className="page-intro">
        <span className="eyebrow">
          {format(parseISO(today), "EEEE, d 'de' MMMM", { locale: es })}
        </span>
        <div className="title-row">
          <h1>
            Tu dinero,
            <br />
            <span>en equilibrio.</span>
          </h1>
          <button
            className="icon-button bordered"
            onClick={share}
            aria-label="Compartir resumen"
          >
            <Share2 size={20} />
          </button>
        </div>
      </div>
      <section className="balance-card">
        <div className="balance-top">
          <span>
            <Wallet size={16} /> Liquidez disponible
          </span>
          <span className="cycle-pill">
            Historial completo
          </span>
        </div>
        <div className="balance-amount">
          <Amount value={available} currency={currency} />
          <span>{currency}</span>
        </div>
        <div className="balance-stats">
          <div>
            <span>
              <ArrowDownLeft size={16} />
              Ingresos
            </span>
            <strong>{money(income, currency)}</strong>
          </div>
          <div>
            <span>
              <ArrowUpRight size={16} />
              Gastos
            </span>
            <strong>{money(expenses, currency)}</strong>
          </div>
        </div>
        <div className="balance-footer">
          <span>
            Ahorro reservado{" "}
            <strong>{money(totals.savingsDeposits - totals.savingsWithdrawals, currency)}</strong>
          </span>
          <span>
            {income ? Math.round((expenses / income) * 100) : 0}% gastado
          </span>
        </div>
        <div className="balance-progress">
          <span
            style={{
              width: `${Math.max(0, Math.min(100, income ? (expenses / income) * 100 : 0))}%`,
            }}
          />
        </div>
      </section>
      {!hasData && (
        <Card className="welcome-card">
          <span className="small-icon">
            <Sparkles size={20} />
          </span>
          <h3>Todo empieza con un registro.</h3>
          <p>
            Un café, tu sueldo, un plan juntos. Dale a tu dinero un lugar para
            empezar.
          </p>
          <button className="button primary full" onClick={() => add()}>
            Registrar mi primer movimiento
          </button>
        </Card>
      )}
      <Link to="/analisis?section=racha" className="streak-card">
        <motion.span
          className="flame-icon"
          animate={{ rotate: [0, -5, 5, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 3 }}
        >
          <Flame size={27} />
        </motion.span>
        <div>
          <div className="streak-title">
            <strong>{streak.current}</strong>
            <span>días sin gastar</span>
          </div>
          <p>
            {hasData
              ? `Mejor: ${streak.best} días${streak.badges.length ? " · " + streak.badges.at(-1) + " días 🏅" : ""}`
              : "Tu próxima buena racha empieza aquí."}
          </p>
        </div>
        <ChevronRight size={18} />
      </Link>
      <SavingsCard />
      {hasData && (
        <>
          <SectionTitle
            title="Pequeñas señales"
            eyebrow="TU DINERO TE CUENTA"
          />
          <div className="insight-list">
            {ants.total > 0 && (
              <Link to="/analisis">
                <span className="small-icon amber">
                  <CoffeeIcon />
                </span>
                <span>
                  <strong>
                    {money(ants.total, currency)} en gastos hormiga
                  </strong>
                  <small>{antGrowth === null ? "Los pequeños gastos también cuentan" : `${antGrowth > 0 ? "Subieron" : "Bajaron"} ${Math.abs(antGrowth).toFixed(0)}% frente a los 30 días anteriores`}</small>
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            {debt.growthPercent !== null && debt.growthPercent > 0 && (
              <Link to="/mas?section=deudas">
                <span className="small-icon">
                  <Wallet size={18} />
                </span>
                <span>
                  <strong>
                    Tu deuda creció {debt.growthPercent.toFixed(1)}%
                  </strong>
                  <small>Frente al cierre del mes anterior</small>
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            {upcoming && (
              <Link to="/mas?section=recurrentes">
                <span className="small-icon">
                  <CalendarClock size={18} />
                </span>
                <span>
                  <strong>{upcoming.descripcion}</strong>
                  <small>
                    {daysBetween(today,upcoming.proximo_pago) < 0 ? "Vencido" : daysBetween(today,upcoming.proximo_pago) === 0 ? "Hoy" : `En ${daysBetween(today,upcoming.proximo_pago)} días`} ·{" "}
                    {format(parseISO(upcoming.proximo_pago), "d MMM", {
                      locale: es,
                    })}
                  </small>
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            {ants.total === 0 && !upcoming && (
              <div className="quiet-insight">
                <Leaf size={19} /> Vas construyendo una relación más clara con
                tu dinero.
              </div>
            )}
          </div>
        </>
      )}
      <SectionTitle title="Tu ritmo financiero">
        <Link to="/analisis" className="text-link">
          Ver análisis <ChevronRight size={14} />
        </Link>
      </SectionTitle>
      <Card>
        {hasData ? (
          <>
            <div className="chart-header">
              <span>Últimos 6 ciclos</span>
              <div className="legend">
                <span>
                  <i className="lavender" />
                  Ingresos
                </span>
                <span>
                  <i />
                  Gastos
                </span>
              </div>
            </div>
            <CashChart data={cycles.slice(-6)} currency={currency} compact />
            <div className="chart-caption">
              <Leaf size={15} />
              <span>
                Ahorro del ciclo{" "}
                <strong>{money(current?.savings ?? 0, currency)}</strong>
              </span>
            </div>
            <p className="footnote">
              Gasto proyectado al cierre:{" "}
              {money(current?.projection ?? 0, currency)}
            </p>
          </>
        ) : (
          <Empty
            title="Tu historia está por dibujarse"
            text="Registra ingresos y gastos para descubrir tu ritmo."
          />
        )}
      </Card>
      {hasData && (
        <>
          <SectionTitle title="Últimos movimientos">
            <Link to="/movimientos" className="text-link">
              Ver todos <ChevronRight size={14} />
            </Link>
          </SectionTitle>
          <Card className="records-card">
            {[...records]
              .sort(
                (a, b) =>
                  b.fecha.localeCompare(a.fecha) ||
                  b.creado_en.localeCompare(a.creado_en),
              )
              .slice(0, 4)
              .map((r) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  categories={categorias}
                  currency={currency}
                  pending={pendingIds.has(r.id)}
                  onClick={() => add(r)}
                />
              ))}
          </Card>
        </>
      )}
      <button className="button secondary full share-button" onClick={share}>
        <Share2 size={17} />
        Compartir mi resumen
      </button>
      <p className="page-signoff">
        Una gota a la vez. Un futuro más tranquilo.
      </p>
    </div>
  );
}
function CoffeeIcon() {
  return <span aria-hidden="true">☕</span>;
}
