import { useMemo, useState } from "react";
import { Download, FileText, Mail, MessageCircle, Share2 } from "lucide-react";
import { useDrip } from "../context";
import { getCycles, todayISO } from "../lib/analytics";
import { generateSummaryPdf } from "../lib/pdf";
import {
  downloadFile,
  emailUrl,
  sharePdf,
  summaryText,
  whatsappUrl,
} from "../lib/share";
import { Sheet } from "./ui";
export default function ShareSheet({ onClose }: { onClose: () => void }) {
  const { data, toast } = useDrip();
  const today = todayISO();
  const cycle = getCycles(data.registros, data.config, today).at(-1);
  const [period, setPeriod] = useState("cycle");
  const [start, setStart] = useState(cycle?.start ?? `${today.slice(0, 7)}-01`);
  const [end, setEnd] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = Boolean(start && end && end >= start);
  const file = useMemo(() => {
    if (!valid) return null;
    try {
      return generateSummaryPdf(data, { start, end });
    } catch {
      return null;
    }
  }, [data, start, end, valid]);
  const text = valid ? summaryText(data, start, end) : "";
  function select(value: string) {
    setPeriod(value);
    if (value === "cycle") setStart(cycle?.start ?? `${today.slice(0, 7)}-01`);
    if (value === "month") setStart(`${today.slice(0, 7)}-01`);
    setEnd(today);
  }
  async function share() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (!(await sharePdf(file, text)))
        setError(
          "Puedes descargar el PDF o compartir el resumen en texto con las opciones de abajo.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo compartir");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Un resumen para compartir" onClose={onClose}>
      <div className="share-intro">
        <span className="empty-icon">
          <FileText size={30} />
        </span>
        <h3>Tus avances, en una página más clara.</h3>
        <p>Genera tu resumen y compártelo con quien hace planes contigo.</p>
      </div>
      <label>
        Periodo
        <select value={period} onChange={(e) => select(e.target.value)}>
          <option value="cycle">Ciclo actual</option>
          <option value="month">Este mes</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>
      {period === "custom" && (
        <div className="form-two">
          <label>
            Desde
            <input
              type="date"
              value={start}
              max={end}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={end}
              min={start}
              max={today}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      <p className="footnote">
        {start} — {end}
      </p>
      {!valid && (
        <p className="error-message">Elige un rango de fechas válido.</p>
      )}
      <div className="sheet-actions">
        <button
          className="button primary full"
          disabled={!file || busy}
          onClick={share}
        >
          <Share2 size={18} />
          Compartir PDF
        </button>
        <button
          className="button secondary full"
          disabled={!file}
          onClick={() => {
            if (file) {
              downloadFile(file);
              toast("PDF descargado");
            }
          }}
        >
          <Download size={18} />
          Descargar PDF
        </button>
        <div className="share-fallbacks">
          <a
            className="button secondary"
            href={whatsappUrl(text)}
            target="_blank"
            rel="noreferrer"
          >
            <MessageCircle size={17} />
            WhatsApp
          </a>
          <a className="button secondary" href={emailUrl(text)}>
            <Mail size={17} />
            Correo
          </a>
        </div>
        <p className="footnote centered">
          WhatsApp y Correo comparten solo texto. Usa “Compartir PDF” para
          adjuntar el archivo desde la hoja nativa.
        </p>
        {error && (
          <p className="note" role="status">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
