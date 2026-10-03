import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  CreditCard,
  Download,
  FlaskConical,
  Info,
  LogOut,
  Plus,
  RefreshCw,
  Repeat2,
  Settings,
  Shapes,
  Smartphone,
  ShieldCheck,
} from "lucide-react";
import { useDrip } from "../context";
import { useSettings } from "../store/settings";
import { useAuth } from "../store/auth";
import { getDebtSummary } from "../lib/analytics";
import { money } from "../lib/format";
import { exportCsv } from "../lib/share";
import { Brand, Card, CategoryIcon, Empty } from "../components/ui";
import EntityEditor from "../components/EntityEditor";
import type { Config, Entity, EntityName } from "../types";
export default function Mas() {
  const {
    data,
    isDemo,
    setDemo,
    sync,
    syncing,
    materialize,
    importLocalRecords,
    saveConfig,
    toast,
  } = useDrip();
  const settings = useSettings();
  const { user, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const section = params.get("section") ?? "";
  const [editor, setEditor] = useState<{
    entity: EntityName;
    value?: Entity;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const debts = getDebtSummary(data.deudas, data.registros);
  const select = (s: string) => {
    setParams(s ? { section: s } : {});
    setError("");
  };
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      toast(message);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo completar la acción",
      );
    } finally {
      setBusy(false);
    }
  }
  async function configSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config: Config = {
      moneda: String(f.get("moneda")),
      umbral_hormiga: Number(f.get("umbral")),
      min_repeticiones_hormiga: Number(f.get("min")),
      tipo_ciclo: String(f.get("ciclo")) as Config["tipo_ciclo"],
      dia_corte: Number(f.get("corte")),
      excluir_fijos_de_racha: f.get("excluir") === "on",
      meta_reduccion_semanal_pct: Number(f.get("meta")),
    };
    await run(() => saveConfig(config), "Preferencias guardadas");
  }
  const title =
    (
      {
        deudas: "Tus deudas",
        recurrentes: "Pagos recurrentes",
        categorias: "Tus categorías",
        ajustes: "A tu manera",
        acerca: "Hola, somos Drip",
      } as Record<string, string>
    )[section] ?? "Un poco más";
  return (
    <div className="page more-page">
      <div className="page-intro">
        {section ? (
          <button className="back-link" onClick={() => select("")}>
            <ChevronLeft size={18} />
            Más
          </button>
        ) : (
          <span className="eyebrow">TU ESPACIO, TUS REGLAS</span>
        )}
        <div className="title-row">
          <h1>
            {title}
            <span className="title-dot">.</span>
          </h1>
          {["deudas", "recurrentes", "categorias"].includes(section) && (
            <button
              className="icon-button bordered"
              aria-label="Crear nuevo"
              onClick={() =>
                setEditor({
                  entity:
                    section === "deudas"
                      ? "deuda"
                      : section === "categorias"
                        ? "categoria"
                        : "recurrente",
                })
              }
            >
              <Plus size={22} />
            </button>
          )}
        </div>
      </div>
      {!section && (
        <>
          <Card className="more-hero">
            <Brand />
            <h2>
              Finanzas contigo.
              <br />Y con quien tú elijas.
            </h2>
            <p>Un espacio compartido para llevar las cuentas con calma.</p>
            <span>
              <ShieldCheck size={15} /> Tus datos, en tu hoja.
            </span>
          </Card>
          {!isDemo && user && (
            <Card>
              <h2>Tu cuenta</h2>
              <p className="muted">
                {user.nombre} · {user.correo}
              </p>
              <button
                className="button secondary full"
                onClick={() => setUser(null)}
              >
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </Card>
          )}
          <Card className="menu-card">
            {[
              {
                id: "deudas",
                label: "Deudas",
                sub: "Un plan para sentirte más libre",
                icon: CreditCard,
              },
              {
                id: "recurrentes",
                label: "Pagos recurrentes",
                sub: "Que ninguna fecha te sorprenda",
                icon: Repeat2,
              },
              {
                id: "categorias",
                label: "Categorías y presupuestos",
                sub: "Dale un lugar a cada gasto",
                icon: Shapes,
              },
              {
                id: "ajustes",
                label: "Ajustes",
                sub: "Conexión y preferencias",
                icon: Settings,
              },
            ].map((item) => (
              <button
                className="menu-row"
                key={item.id}
                onClick={() => select(item.id)}
              >
                <span className="small-icon">
                  <item.icon size={20} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.sub}</small>
                </span>
                <ChevronRight size={18} />
              </button>
            ))}
          </Card>
          <Card className="menu-card">
            <button
              className="menu-row"
              onClick={() => run(sync, "Sincronización completada")}
              disabled={syncing}
            >
              <span className="small-icon">
                <RefreshCw size={20} className={syncing ? "spin" : ""} />
              </span>
              <span>
                <strong>Sincronizar ahora</strong>
                <small>Actualizar tu hoja y este dispositivo</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              className="menu-row"
              onClick={() => {
                exportCsv(data);
                toast("CSV exportado");
              }}
            >
              <span className="small-icon">
                <Download size={20} />
              </span>
              <span>
                <strong>Exportar movimientos</strong>
                <small>Descarga una copia en CSV</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button className="menu-row" onClick={() => setDemo(!isDemo)}>
              <span className="small-icon">
                <FlaskConical size={20} />
              </span>
              <span>
                <strong>Modo demo</strong>
                <small>Explora con datos de ejemplo</small>
              </span>
              <span
                role="switch"
                aria-checked={isDemo}
                aria-label="Modo demo"
                className={`switch ${isDemo ? "on" : ""}`}
              />
            </button>
            <button className="menu-row" onClick={() => select("acerca")}>
              <span className="small-icon">
                <Info size={20} />
              </span>
              <span>
                <strong>Acerca de Drip</strong>
                <small>Una gota a la vez</small>
              </span>
              <ChevronRight size={18} />
            </button>
          </Card>
          <div className="install-note">
            <Smartphone size={22} />
            <div>
              <strong>Un lugar en tu pantalla de inicio</strong>
              <p>En Safari, toca Compartir y “Añadir a pantalla de inicio”.</p>
            </div>
          </div>
          <p className="page-signoff">
            Hecho para tus planes. Y los de ustedes.
          </p>
        </>
      )}
      {section === "deudas" && (
        <>
          <Card className="total-card">
            <span className="eyebrow">SALDO TOTAL ESTIMADO</span>
            <strong>{money(debts.balance, data.config.moneda)}</strong>
          </Card>
          {data.deudas.length ? (
            data.deudas.map((d) => (
              <button
                className="card entity-card"
                key={d.id}
                onClick={() => setEditor({ entity: "deuda", value: d })}
              >
                <span className="small-icon">
                  <CreditCard size={21} />
                </span>
                <span>
                  <strong>
                    {d.nombre}
                    {!d.activa && " · Inactiva"}
                  </strong>
                  <small>
                    {d.acreedor} · {d.tasa_interes_mensual}% mensual
                  </small>
                  <small>
                    Cuota: {money(d.cuota_minima, data.config.moneda)} · día{" "}
                    {d.dia_pago}
                  </small>
                </span>
                <strong>
                  {money(
                    debts.items.find((item) => item.id === d.id)?.balance ?? 0,
                    data.config.moneda,
                  )}
                </strong>
              </button>
            ))
          ) : (
            <Card>
              <Empty
                title="Un plan empieza por conocer el saldo"
                text="Añade una deuda para seguir tus abonos, estimar intereses y ver tu avance."
              >
                <button
                  className="button primary"
                  onClick={() => setEditor({ entity: "deuda" })}
                >
                  Añadir deuda
                </button>
              </Empty>
            </Card>
          )}
        </>
      )}
      {section === "recurrentes" && (
        <>
          <div className="note">
            Los vencimientos se convierten en gastos al tocar “Registrar
            vencidos”. Revisa que los pagos sí se hayan realizado.
          </div>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() => run(materialize, "Pagos vencidos registrados")}
          >
            <Repeat2 size={17} />
            {busy ? "Registrando…" : "Registrar vencidos"}
          </button>
          {data.recurrentes.length ? (
            data.recurrentes.map((r) => (
              <button
                className="card entity-card"
                key={r.id}
                onClick={() => setEditor({ entity: "recurrente", value: r })}
              >
                <CategoryIcon
                  category={data.categorias.find(
                    (c) => c.nombre === r.categoria,
                  )}
                />
                <span>
                  <strong>
                    {r.descripcion}
                    {!r.activa && " · Pausado"}
                  </strong>
                  <small>
                    {r.frecuencia} · {r.proximo_pago}
                  </small>
                </span>
                <strong>{money(r.monto, data.config.moneda)}</strong>
              </button>
            ))
          ) : (
            <Card>
              <Empty
                title="Tus pagos, en orden"
                text="Guarda servicios, arriendo o suscripciones como pagos recurrentes."
              >
                <button
                  className="button primary"
                  onClick={() => setEditor({ entity: "recurrente" })}
                >
                  Crear pago recurrente
                </button>
              </Empty>
            </Card>
          )}
        </>
      )}
      {section === "categorias" && (
        <Card className="menu-card">
          {data.categorias.map((cat) => (
            <button
              key={cat.id}
              className="menu-row"
              onClick={() => setEditor({ entity: "categoria", value: cat })}
            >
              <CategoryIcon category={cat} />
              <span>
                <strong>
                  {cat.nombre}
                  {!cat.activa && " · Inactiva"}
                </strong>
                <small>
                  {cat.tipo === "ingreso"
                    ? "Ingreso"
                    : cat.presupuesto_mensual
                      ? `Presupuesto: ${money(cat.presupuesto_mensual, data.config.moneda)}`
                      : "Sin presupuesto mensual"}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </Card>
      )}
      {section === "ajustes" && (
        <>
          <Card>
            <h2>Conecta tu hoja</h2>
            <p className="muted">
              La URL de tu implementación de Apps Script se toma de la
              configuración del sitio y no se puede editar aquí.
            </p>
            <p className="footnote">
              {settings.url || "No hay una URL configurada; revisa VITE_APPS_SCRIPT_URL."}
            </p>
            <button
              className="button secondary full"
              disabled={busy || syncing}
              onClick={() =>
                run(sync, "Conexión verificada y datos actualizados")
              }
            >
              <RefreshCw size={17} />
              Probar y sincronizar
            </button>
            <button
              className="text-button full"
              disabled={busy || isDemo}
              onClick={() =>
                run(async () => {
                  const count = await importLocalRecords();
                  toast(`${count} registros locales importados`);
                }, "Importación completada")
              }
            >
              <CloudUpload size={17} />
              Importar registros de este dispositivo
            </button>
            <p className="footnote">
              Importa los movimientos creados antes de conectar una hoja.
              Mantiene sus identificadores para evitar duplicados.
            </p>
          </Card>
          <Card>
            <h2>Tus preferencias</h2>
            <form
              className="form-stack"
              onSubmit={configSubmit}
              key={`${isDemo}-${data.config.moneda}-${data.config.tipo_ciclo}`}
            >
              <div className="form-two">
                <label>
                  Moneda
                  <select name="moneda" defaultValue={data.config.moneda}>
                    {["COP", "USD", "EUR", "MXN", "PEN", "CLP", "ARS"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Ciclo
                  <select name="ciclo" defaultValue={data.config.tipo_ciclo}>
                    <option value="auto">Automático</option>
                    <option value="mensual">Mensual</option>
                    <option value="quincenal">Quincenal</option>
                  </select>
                </label>
                <label>
                  Día de corte
                  <input
                    name="corte"
                    type="number"
                    required
                    min="1"
                    max="31"
                    defaultValue={data.config.dia_corte}
                  />
                </label>
                <label>
                  Umbral hormiga
                  <input
                    name="umbral"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    defaultValue={data.config.umbral_hormiga}
                  />
                </label>
                <label>
                  Repeticiones mínimas
                  <input
                    name="min"
                    type="number"
                    min="2"
                    max="100"
                    required
                    defaultValue={data.config.min_repeticiones_hormiga}
                  />
                </label>
                <label>
                  Reducción semanal (%)
                  <input
                    name="meta"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    required
                    defaultValue={data.config.meta_reduccion_semanal_pct}
                  />
                </label>
              </div>
              <label className="check-field">
                <input
                  name="excluir"
                  type="checkbox"
                  defaultChecked={data.config.excluir_fijos_de_racha}
                />
                Excluir gastos fijos de la racha (los abonos siempre cuentan)
              </label>
              <p className="footnote">
                Cambiar la moneda modifica el formato; no convierte los montos.
              </p>
              <button className="button primary full" disabled={busy}>
                {busy ? "Guardando…" : "Guardar preferencias"}
              </button>
            </form>
          </Card>
        </>
      )}
      {section === "acerca" && (
        <Card className="about-card">
          <Brand />
          <h2>
            Daily Records for
            <br />
            Individuals & Partners
          </h2>
          <p>
            Drip te ayuda a registrar tus finanzas personales y en pareja. Menos
            números sueltos, más decisiones compartidas.
          </p>
          <p>
            Una sola libreta, sin usuarios ni perfiles. Puedes usar tags como
            “mío”, “pareja” y “juntos” para organizar los movimientos.
          </p>
          <div className="note">
            Tus movimientos viven en tu Google Sheet y se guardan en este
            dispositivo para funcionar sin conexión. La demo usa un espacio
            separado y nunca se envía a tu hoja.
          </div>
          <p>Sin rastreadores. Sin cuentas adicionales. Un paso a la vez.</p>
          <small>Drip 1.0.0 · Hecho para iPhone</small>
        </Card>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            Cerrar
          </button>
        </div>
      )}
      {editor && <EntityEditor {...editor} onClose={() => setEditor(null)} />}
    </div>
  );
}
