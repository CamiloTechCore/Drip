import { useState, type FormEvent } from "react";
import { LogIn, UserPlus } from "lucide-react";
import * as client from "../api/client";
import { useSettings } from "../store/settings";
import { useAuth } from "../store/auth";
import { validateEmail, validateName, validatePassword } from "../api/validation";
import { Brand, Card } from "../components/ui";

export default function Login() {
  const settings = useSettings();
  const { setUser } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState(settings.token);
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsConnection = !settings.url || !settings.token;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let connectionUrl = settings.url;
      let connectionToken = settings.token;
      if (needsConnection) {
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url.trim()))
          throw new Error("Usa la URL de Apps Script que termina en /exec.");
        if (token.trim().length < 24)
          throw new Error("El token debe tener al menos 24 caracteres.");
        connectionUrl = url.trim();
        connectionToken = token.trim();
        settings.setSettings({ url: connectionUrl, token: connectionToken });
      }
      const account = await client.getAccount({ url: connectionUrl, token: connectionToken, isDemo: false });
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
    <div className="page">
      <div className="page-intro">
        <Brand />
        <p>Daily Records for Individuals & Partners</p>
      </div>
      <Card>
        <h2>{mode === "login" ? "Ingresar" : "Crear cuenta"}</h2>
        <p className="muted">
          {mode === "login"
            ? "Ingresa con tu correo y contraseña para ver tus registros."
            : "Crea tu cuenta con nombre, correo y contraseña."}
        </p>
        <form className="form-stack" onSubmit={submit}>
          {needsConnection && (
            <>
              <label>
                URL de Apps Script
                <input
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/…/exec"
                  required
                />
              </label>
              <label>
                Token de acceso
                <input
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Al menos 24 caracteres"
                  required
                />
              </label>
            </>
          )}
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
  );
}
