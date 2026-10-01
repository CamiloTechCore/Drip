import { useState, type FormEvent } from "react";
import { LogIn, UserPlus } from "lucide-react";
import * as client from "../api/client";
import { useSettings } from "../store/settings";
import { useAuth } from "../store/auth";
import { validateEmail, validateName, validatePassword } from "../api/validation";
import { Brand, Card } from "../components/ui";
import { NeuralCanvas } from "../components/NeuralCanvas";

export default function Login() {
  const settings = useSettings();
  const { setUser } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // La URL de Apps Script se toma de la configuración del sitio.
      const account = await client.getAccount({ url: settings.url, isDemo: false });
      const correoValido = validateEmail(correo);
      const passwordValido = validatePassword(password);
      const user = mode === "register"
        ? await client.registerUser(account, { nombre: validateName(nombre), correo: correoValido, password: passwordValido })
        : await client.loginUser(account, { correo: correoValido, password: passwordValido });
      setUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-visual" aria-hidden="true">
        <Brand />
        <NeuralCanvas />
       
      </div>
      <div className="auth-panel">
        <Card>
          <h2>{mode === "login" ? "Ingresar" : "Crear cuenta"}</h2>
          <p className="muted">
            {mode === "login"
              ? "Ingresa con tu correo y contraseña para ver tus registros."
              : "Crea tu cuenta con nombre, correo y contraseña."}
          </p>
          <form className="form-stack" onSubmit={submit}>
            {mode === "register" && (
              <label>
                Nombre
                <input
                  type="text"
                  autoComplete="name"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Tu nombre"
                  required
                />
              </label>
            )}
            <label>
              Correo
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="tucorreo@ejemplo.com"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Más de 8 caracteres, con un carácter especial"
                required
              />
            </label>
            {error && (
              <p className="footnote" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {mode === "login" ? <LogIn size={17} /> : <UserPlus size={17} />}
              {busy ? "Un momento…" : mode === "login" ? "Ingresar" : "Registrarme"}
            </button>
          </form>
          <button
            className="text-button full"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Ingresa"}
          </button>
        </Card>
      </div>
    </div>
  );
}

