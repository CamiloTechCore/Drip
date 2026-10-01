import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  Plus,
  CloudUpload,
  Pencil,
} from "lucide-react";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useDrip } from "../context";
import { Card, Empty, RecordRow } from "../components/ui";
import { money } from "../lib/format";
import { normalizeDescription } from "../lib/analytics";
export default function Movimientos() {
  const { data, add, sync, syncing, pendingIds, pending, toast } = useDrip();
  const [params] = useSearchParams();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(
    Boolean(params.get("categoria") || params.get("tag")),
  );
  const [category, setCategory] = useState(params.get("categoria") ?? "");
  const [type, setType] = useState("");
  const [tag, setTag] = useState(params.get("tag") ?? "");
  const [method, setMethod] = useState("");
  const [need, setNeed] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const touch = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  async function refresh() {
    try {
      await sync();
      toast("Movimientos actualizados");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo sincronizar");
    }
  }
  const records = data.registros
    .filter(
      (r) =>
        !r.eliminado &&
        (!search ||
          normalizeDescription(
            `${r.descripcion} ${r.categoria} ${r.tags}`,
          ).includes(normalizeDescription(search))) &&
        (!category || r.categoria === category) &&
        (!type || r.tipo === type) &&
        (!tag || r.tags.split(",").includes(tag)) &&
        (!method || r.metodo_pago === method) &&
        (!need || r.necesidad === need) &&
        (!start || r.fecha >= start) &&
        (!end || r.fecha <= end),
    )
    .sort(
      (a, b) =>
        b.fecha.localeCompare(a.fecha) ||
        b.creado_en.localeCompare(a.creado_en),
    );
  const days = [...new Set(records.map((r) => r.fecha))];
  const tags = [
    ...new Set(
      data.registros.flatMap((r) => r.tags.split(",")).filter(Boolean),
    ),
  ];
  return (
    <div
      className="page"
      onTouchStart={(e) => {
        touch.current = window.scrollY === 0 ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (touch.current !== null)
          setPull(
            Math.max(0, Math.min(85, e.touches[0].clientY - touch.current)),
          );
      }}
      onTouchEnd={() => {
        if (pull > 65) void refresh();
        touch.current = null;
        setPull(0);
      }}
    >
      <div className="page-intro">
        <span className="eyebrow">CADA GOTA CUENTA</span>
        <div className="title-row">
          <h1>
            Movimientos<span className="title-dot">.</span>
          </h1>
          <button
            className="icon-button bordered"
            onClick={() => add()}
            aria-label="Agregar movimiento"
          >
            <Plus size={21} />
          </button>
        </div>
        <p>Tu día a día, en un solo lugar.</p>
      </div>
      <div className="search-row">
        <label className="search-box">
          <Search size={19} />
          <input
            aria-label="Buscar movimientos"
            placeholder="Buscar un movimiento…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          className={`icon-button bordered ${filter ? "selected" : ""}`}
          aria-label="Mostrar filtros"
          aria-expanded={filter}
          onClick={() => setFilter(!filter)}
        >
          <SlidersHorizontal size={19} />
        </button>
      </div>
      {filter && (
        <Card className="filter-card">
          <div className="form-two">
            <label>
              Tipo
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">Todos</option>
                <option value="gasto">Gastos</option>
                <option value="ingreso">Ingresos</option>
                <option value="deuda_pago">Abonos a deuda</option>
                <option value="deuda_aumento">Aumentos de deuda</option>
                <option value="sin_gasto">Sin gasto</option>
              </select>
            </label>
            <label>
              Categoría
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Todas</option>
                {data.categorias.map((c) => (
                  <option key={c.id}>{c.nombre}</option>
                ))}
              </select>
            </label>
            <label>
              Tag
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Todos</option>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Método
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="">Todos</option>
                {["efectivo", "debito", "credito", "transferencia", "otro"].map(
                  (m) => (
                    <option key={m}>{m}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Necesidad
              <select value={need} onChange={(e) => setNeed(e.target.value)}>
                <option value="">Todas</option>
                <option value="necesario">Necesario</option>
                <option value="innecesario">Un gusto</option>
              </select>
            </label>
            <span />
            <label>
              Desde
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setType("");
              setCategory("");
              setTag("");
              setMethod("");
              setNeed("");
              setStart("");
              setEnd("");
              setSearch("");
            }}
          >
            Limpiar filtros
          </button>
        </Card>
      )}
      <div className="list-meta">
        <span>
          {records.length} movimientos{" "}
          {pending > 0 && (
            <span className="pending-count">
              <CloudUpload size={13} />
              {pending}
            </span>
          )}
        </span>
        <button className="text-button" onClick={refresh} disabled={syncing}>
          <RefreshCw size={14} className={syncing ? "spin" : ""} />
          Actualizar
        </button>
      </div>
      {pull > 0 && (
        <div className="pull-indicator" style={{ height: pull }}>
          <RefreshCw size={18} />
          {pull > 65 ? "Suelta para actualizar" : "Desliza para actualizar"}
        </div>
      )}
      {records.length === 0 ? (
        <Card>
          <Empty
            title="Aquí comienza tu historia"
            text={
              search || filter
                ? "No hay movimientos que coincidan con estos filtros."
                : "Registra tu primer movimiento y empieza a conocer tu dinero."
            }
          >
            <button className="button primary" onClick={() => add()}>
              Agregar movimiento
            </button>
          </Empty>
        </Card>
      ) : (
        days.map((day) => (
          <section className="day-group" key={day}>
            <div className="day-heading">
              <h2>{format(parseISO(day), "EEEE, d MMM", { locale: es })}</h2>
              <span>
                {money(
                  records
                    .filter((r) => r.fecha === day)
                    .reduce(
                      (sum, r) =>
                        sum +
                        (r.tipo === "ingreso"
                          ? r.monto
                          : r.tipo === "gasto" || r.tipo === "deuda_pago"
                            ? -r.monto
                            : 0),
                      0,
                    ),
                  data.config.moneda,
                )}
              </span>
            </div>
            <Card className="records-card">
              {records
                .filter((r) => r.fecha === day)
                .map((r) => (
                  <div className="swipe-container" key={r.id}>
                    <button
                      className="swipe-action"
                      onClick={() => add(r)}
                      aria-label="Editar o eliminar"
                    >
                      <Pencil size={18} />
                    </button>
                    <motion.div
                      drag="x"
                      dragConstraints={{ left: -65, right: 0 }}
                      dragElastic={0.05}
                    >
                      <RecordRow
                        record={r}
                        categories={data.categorias}
                        currency={data.config.moneda}
                        pending={pendingIds.has(r.id)}
                        onClick={() => add(r)}
                      />
                    </motion.div>
                  </div>
                ))}
            </Card>
          </section>
        ))
      )}
      <p className="footnote centered">
        Toca o desliza un movimiento para editarlo o eliminarlo.
      </p>
    </div>
  );
}
