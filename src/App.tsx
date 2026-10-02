import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { NavLink, useLocation, Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Home,
  ArrowLeftRight,
  Plus,
  ChartNoAxesCombined,
  Grid2X2,
  Cloud,
  CloudOff,
  CloudUpload,
  RefreshCw,
  X,
  Check,
  FlaskConical,
  Star,
} from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useData } from "./hooks/useData";
import { useAuth } from "./store/auth";
import { AppContext } from "./context";
import { Brand } from "./components/ui";
import BubbleBackground from "./components/BubbleBackground";
import AppFooter from "./components/AppFooter";
import SavingsSheet from "./components/SavingsSheet";
import { isSavingsDeposit, isSavingsWithdrawal } from "./lib/analytics";
import type { SavingsMode } from "./lib/savings";
const ShareSheet = lazy(() => import("./components/ShareSheet"));
import Agregar from "./pages/Agregar";
import Login from "./pages/Login";
import AppRoutes from "./router";
import type { Registro } from "./types";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Financial data must never be logged. */
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>Hagamos una pausa.</h1>
        <p>
          No pudimos mostrar esta pantalla. Tus registros guardados siguen en
          este dispositivo.
        </p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Volver a abrir Drip
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <DripApp />
    </ErrorBoundary>
  );
}
function DripApp() {
  const model = useData();
  const { user } = useAuth();
  const needsAuth = !model.isDemo && !user;
  const location = useLocation();
  const [capture, setCapture] = useState<{ record?: Registro } | null>(null);
  const [savingsCapture, setSavingsCapture] = useState<{ mode: SavingsMode; record?: Registro } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const on = () => setOnline(true),
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3800);
    return () => clearTimeout(timer);
  }, [message]);
  const openSavings = (mode: SavingsMode, record?: Registro) => {
    setCapture(null);
    setSavingsCapture({ mode, record });
  };
  const add = (record?: Registro) => {
    if (record && (isSavingsDeposit(record) || isSavingsWithdrawal(record))) {
      openSavings(isSavingsDeposit(record) ? 'deposit' : 'withdraw', record);
      return;
    }
    setSavingsCapture(null);
    setCapture({ record });
  };
  const share = () => setSharing(true);
  return (
    <AppContext.Provider value={{ ...model, add, openSavings, share, toast: setMessage }}>
      <div className={`app-shell${needsAuth ? " app-shell--auth" : ""}`}>
        <BubbleBackground />
        {needsAuth ? (
          <Login />
        ) : (
          <>
        <header className="app-header">
          <Link to="/" aria-label="Drip, ir al inicio">
            <Brand />
          </Link>
          <span
            className={`connection-status ${!online ? "offline" : ""}`}
            title={
              model.isDemo
                ? "Los datos de ejemplo nunca se sincronizan"
                : model.pending
                  ? "Guardado en este dispositivo"
                  : "Estado de conexión"
            }
          >
            {model.isDemo ? (
              <>
                <FlaskConical size={14} />
                Demo
              </>
            ) : model.syncing ? (
              <>
                <RefreshCw size={14} className="spin" />
                Sincronizando
              </>
            ) : !online ? (
              <>
                <CloudOff size={15} />
                Sin conexión
              </>
            ) : model.pending ? (
              <>
                <CloudUpload size={15} />
                {model.pending} pendientes
              </>
            ) : (
              <>
                <Cloud size={15} />
                En tu espacio
              </>
            )}
          </span>
        </header>
        {model.isDemo && (
          <div className="demo-banner">
            <span>Estás explorando con datos de ejemplo</span>
            <button onClick={() => model.setDemo(false)}>Salir</button>
          </div>
        )}
        {model.error && (
          <div className="sync-error" role="alert">
            <span>{model.error}</span>
            <button onClick={() => void model.sync().catch(() => undefined)}>
              Reintentar
            </button>
          </div>
        )}
        {needRefresh && (
          <div className="update-banner">
            <span>Hay una nueva versión de Drip.</span>
            <button
              disabled={model.syncing}
              onClick={() => void updateServiceWorker(true)}
            >
              Actualizar
            </button>
            <button
              className="icon-button"
              aria-label="Recordar después"
              onClick={() => setNeedRefresh(false)}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <main>
          {model.loading ? (
            <div
              className="page skeleton-page"
              aria-label="Abriendo tus registros"
              role="status"
            >
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-balance" />
              <div className="skeleton skeleton-streak" />
              <div className="skeleton skeleton-chart" />
            </div>
          ) : (
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <AppRoutes />
            </motion.div>
          )}
        </main>
        <AppFooter />
        <nav className="bottom-nav" aria-label="Navegación principal">
          <NavLink to="/" end>
            <Home size={21} />
            <span>Inicio</span>
          </NavLink>
          <NavLink to="/movimientos">
            <ArrowLeftRight size={21} />
            <span>Movimientos</span>
          </NavLink>
          <button
            className="nav-add"
            onClick={() => add()}
            aria-label="Agregar movimiento"
          >
            <span>
              <Plus size={28} />
            </span>
            <small>Agregar</small>
          </button>
          <NavLink to="/analisis">
            <ChartNoAxesCombined size={21} />
            <span>Análisis</span>
          </NavLink>
          <NavLink to="/wishes">
            <Star size={21} />
            <span>Deseos</span>
          </NavLink>
          <NavLink to="/mas">
            <Grid2X2 size={21} />
            <span>Más</span>
          </NavLink>
        </nav>
        <AnimatePresence>
          {capture && (
            <Agregar record={capture.record} onClose={() => setCapture(null)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {savingsCapture && (
            <SavingsSheet {...savingsCapture} onClose={() => setSavingsCapture(null)} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {sharing && (
            <Suspense
              fallback={
                <div className="toast" role="status">
                  Preparando tu resumen…
                </div>
              }
            >
              <ShareSheet onClose={() => setSharing(false)} />
            </Suspense>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {message && (
            <motion.div
              role="status"
              className="toast"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
            >
              <Check size={17} />
              {message}
            </motion.div>
          )}
        </AnimatePresence>
          </>
        )}
      </div>
    </AppContext.Provider>
  );
}
