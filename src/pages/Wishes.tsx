import { useState, useEffect, useRef, type FormEvent } from "react";
import { Star, Plus, Users, Wallet, ThumbsUp, ThumbsDown, Clock, MessageSquare, Check, Trash2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useDrip } from "../context";
import { Card, Empty } from "../components/ui";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import * as client from "../api/client";
import { money } from "../lib/format";
import type { Team, Deseo, VotoTipo } from "../types";

export default function Wishes() {
  const { user } = useAuth();
  const settings = useSettings();
  const { toast, data, sync, syncing } = useDrip();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const contributionAttempt = useRef<{ key: string; id: string } | null>(null);
  const teamDraftId = useRef(crypto.randomUUID());
  const wishDraftId = useRef(crypto.randomUUID());
  const [view, setView] = useState<'teams' | 'create-team' | 'team-detail' | 'create-wish'>('teams');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [expandedWish, setExpandedWish] = useState<string | null>(null);
  const [account, setAccount] = useState<client.Account | null>(null);

  useEffect(() => {
    if (!settings.isDemo) {
      client.getAccount({ url: settings.url, isDemo: settings.isDemo })
        .then(setAccount)
        .catch(() => toast('No pudimos abrir el almacenamiento seguro.'));
    }
  }, [settings.url, settings.isDemo, toast]);

  // Every page reads the same normalized, account-filtered snapshot.
  const teams = (data.teams ?? []).filter(team => team.activo);
  const deseos = (data.deseos ?? []).filter(wish => !wish.eliminado);


  const displayDeseos = deseos;


  const handleCreateTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !account) {
      toast('Debes estar autenticado para crear un Team');
      return;
    }
    const form = e.target as HTMLFormElement;
    const nombre = (form.elements.namedItem('team-name') as HTMLInputElement).value;
    const correo = (form.elements.namedItem('invite-email') as HTMLInputElement).value;

    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await client.createTeam(account, nombre, user.id, correo, teamDraftId.current);
      teamDraftId.current = crypto.randomUUID();
      toast('Team creado exitosamente');
      setView('teams');
      form.reset();
    } catch (error) {
      toast('Error al crear el Team: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    } finally { submitting.current = false; setBusy(false); }
  };

  const handleCreateWish = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !account || !selectedTeam) {
      toast('Debes estar autenticado y seleccionar un Team');
      return;
    }
    const form = e.target as HTMLFormElement;
    const titulo = (form.elements.namedItem('wish-title') as HTMLInputElement).value;
    const descripcion = (form.elements.namedItem('wish-description') as HTMLTextAreaElement).value;
    const montoObjetivo = Number((form.elements.namedItem('wish-amount') as HTMLInputElement).value);

    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      await client.createWish(account, selectedTeam.id, titulo, descripcion, montoObjetivo, user.id, wishDraftId.current);
      wishDraftId.current = crypto.randomUUID();
      toast('Deseo creado exitosamente');
      setView('team-detail');
      form.reset();
    } catch (error) {
      toast('Error al crear el Deseo: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    } finally { submitting.current = false; setBusy(false); }
  };

  const handleDeleteWish = async (wish: Deseo) => {
    if (!user || !account || submitting.current) return;
    if (!window.confirm('¿Eliminar este deseo? Los aportes y movimientos ya registrados se conservarán; esta acción no devuelve dinero.')) return;
    submitting.current = true; setBusy(true);
    try {
      await client.deleteWish(account, wish.id, user.id);
      setExpandedWish(null);
      toast('Deseo eliminado');
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo eliminar el deseo'); }
    finally { submitting.current = false; setBusy(false); }
  };

  const handleVote = async (wishId: string, tipo: VotoTipo) => {
    if (!user || !account) {
      toast('Debes estar autenticado para votar');
      return;
    }
    try {
      await client.voteWish(account, wishId, tipo, user.id);
      toast('Voto registrado');
    } catch (error) {
      toast('Error al votar: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  const handleAddComment = async (wishId: string, comentario: string) => {
    if (!user || !account) {
      toast('Debes estar autenticado para comentar');
      return;
    }
    try {
      await client.addComment(account, wishId, comentario, user.id);
      toast('Comentario agregado');
    } catch (error) {
      toast('Error al agregar comentario: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  const handleContribute = async (wish: Deseo, amount: number) => {
    if (!user || !account || submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const key = JSON.stringify([wish.id, amount, user.id]);
      if (contributionAttempt.current?.key !== key) contributionAttempt.current = { key, id: crypto.randomUUID() };
      await client.contributeWish(account, wish.id, amount, user.id, contributionAttempt.current.id);
      contributionAttempt.current = null;
      toast('Aporte registrado y liquidez actualizada');
    } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo registrar el aporte'); }
    finally { submitting.current = false; setBusy(false); }
  };

  if (view === 'teams') {
    return (
      <div className="page wishes-page">
        <header className="page-header">
          <h1>
            <Star size={24} />
            Deseos
          </h1>
          <button className="text-button" disabled={syncing} onClick={() => void sync().catch(error => toast(error instanceof Error ? error.message : 'No se pudo actualizar'))}>
            <RefreshCw size={16} className={syncing ? 'spin' : ''} /> Actualizar
          </button>
          <button
            className="button primary"
            onClick={() => setView('create-team')}
          >
            <Plus size={18} />
            Crear Team
          </button>
        </header>

        {teams.length === 0 ? (
          <Empty
            title="Aún no tienes Teams"
            text="Crea tu primer Team para empezar a planificar deseos en pareja."
          />
        ) : (
          <div className="teams-grid">
            {teams.map((team) => (
              <Card
                key={team.id}
                className="team-card"
                onClick={() => {
                  setSelectedTeam(team);
                  setView('team-detail');
                }}
              >
                <div className="team-icon">
                  <Users size={32} />
                </div>
                <h3>{team.nombre}</h3>
                <p>{team.miembros.length} miembro{team.miembros.length !== 1 ? 's' : ''}</p>
                <span className="team-arrow">→</span>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === 'create-team') {
    return (
      <div className="page">
        <header className="page-header">
          <button
            className="icon-button"
            onClick={() => setView('teams')}
          >
            <ChevronDown size={24} />
          </button>
          <h1>Crear Team</h1>
        </header>

        <Card>
          <form onSubmit={handleCreateTeam} className="form">
            <div className="form-group">
              <label htmlFor="team-name">Nombre del Team</label>
              <input
                id="team-name"
                type="text"
                placeholder="Ej: Viaje París, Ahorro Casa, etc."
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="invite-email">Invitar por correos</label>
              <input
                id="invite-email"
                type="email"
                multiple
                placeholder="ana@ejemplo.com, luis@ejemplo.com"
              />
              <small className="form-hint">
                Separa cada correo con una coma. Todas las personas deben estar registradas.
              </small>
            </div>

            <button type="submit" className="button primary full-width" disabled={busy || !account}>
              {busy ? 'Guardando…' : 'Crear Team'}
            </button>
          </form>
        </Card>
      </div>
    );
  }

  if (view === 'team-detail' && selectedTeam) {
    const teamDeseos = displayDeseos.filter(d => d.team_id === selectedTeam.id);
    const currentWallet = { saldo: teamDeseos.reduce((sum, wish) => sum + wish.monto_actual, 0) };

    return (
      <div className="page">
        <header className="page-header">
          <button
            className="icon-button"
            onClick={() => {
              setSelectedTeam(null);
              setView('teams');
            }}
          >
            <ChevronDown size={24} />
          </button>
          <h1>{selectedTeam.nombre}</h1>
          <button
            className="icon-button"
            onClick={() => setView('create-wish')}
          >
            <Plus size={24} />
          </button>
        </header>

        {currentWallet && (
          <Card className="wallet-card">
            <div className="wallet-header">
              <Wallet size={24} />
              <h2>Aportes a tus deseos</h2>
            </div>
            <div className="wallet-balance">
              <span className="wallet-amount">
                ${currentWallet.saldo.toLocaleString()}
              </span>
              <span className="wallet-label">aportados</span>
            </div>
            <p className="muted">Registra tus aportes dentro de cada deseo aprobado.</p>
          </Card>
        )}

        {teamDeseos.length === 0 ? (
          <Empty
            title="Aún no hay deseos"
            text="Crea el primer deseo para este Team y empieza a planificar juntos."
          />
        ) : (
          <div className="wishes-list">
            {teamDeseos.map((deseo) => {
              const likes = deseo.votos.filter(v => v.tipo === 'like').length;
              const dislikes = deseo.votos.filter(v => v.tipo === 'dislike').length;
              const revision = deseo.votos.filter(v => v.tipo === 'revision').length;
              const isExpanded = expandedWish === deseo.id;
              const progress = deseo.monto_objetivo > 0 ? (deseo.monto_actual / deseo.monto_objetivo) * 100 : 0;
              const members = [...new Set([...selectedTeam.miembros, deseo.creador_id])];
              const cents = Math.round(deseo.monto_objetivo * 100);
              const ordered = members.slice().sort();
              const quota = (Math.floor(cents / members.length) + (ordered.indexOf(user?.id ?? '') < cents % members.length ? 1 : 0)) / 100;
              const contributed = deseo.aportes?.[user?.id ?? ''] ?? 0;
              const remaining = Math.max(0, Math.round((quota - contributed) * 100) / 100);

              return (
                <Card key={deseo.id} className="wish-card">
                  <div
                    className="wish-header"
                    onClick={() => setExpandedWish(isExpanded ? null : deseo.id)}
                  >
                    <div className="wish-info">
                      <h3>{deseo.titulo}</h3>
                      <p>{deseo.descripcion}</p>
                    </div>
                    <div className="wish-status">
                      {deseo.aprobado ? (
                        <span className="status-badge approved">
                          <Check size={14} />
                          Aprobado
                        </span>
                      ) : (
                        <span className="status-badge pending">
                          <Clock size={14} />
                          En votación
                        </span>
                      )}
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>

                  {deseo.aprobado && (
                    <div className="wish-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <div className="progress-text">
                        <span>${deseo.monto_actual.toLocaleString()}</span>
                        <span>de ${deseo.monto_objetivo.toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  {deseo.aprobado && (
                    <form className="form-stack wish-contribution" onSubmit={event => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const amount = Number((form.elements.namedItem('aporte') as HTMLInputElement).value);
                      void handleContribute(deseo, amount);
                    }}>
                      <p className="muted">Cuota por persona: {money(quota, data.config.moneda)} · {members.length} participantes · Pendiente: {money(remaining, data.config.moneda)}</p>
                      <p className="footnote">{deseo.creador_id === user?.id ? 'Tu primer aporte registra el gasto total del presupuesto. Los aportes de invitados llegan como ingresos.' : 'Tu aporte se descuenta de tu liquidez y llega al creador del deseo.'}</p>
                      <label>Valor del aporte<input name="aporte" type="number" min="0.01" step="0.01" key={`${deseo.id}-${remaining}`} max={remaining} defaultValue={remaining} required /></label>
                      <button className="button primary full" disabled={busy || !account || remaining <= 0 || deseo.monto_actual >= deseo.monto_objetivo}>Añadir valor al deseo</button>
                    </form>
                  )}
                  {(deseo.creador_id === user?.id || selectedTeam.creador_id === user?.id) && (
                    <button type="button" className="text-button danger-text" disabled={busy || !account} onClick={() => void handleDeleteWish(deseo)}>
                      <Trash2 size={16} /> Eliminar deseo
                    </button>
                  )}
                  <div className="wish-votes">
                    <button
                      className={`vote-button ${deseo.votos.find(v => v.usuario_id === user?.id)?.tipo === 'like' ? 'active' : ''}`}
                      onClick={() => handleVote(deseo.id, 'like')}
                    >
                      <ThumbsUp size={18} />
                      <span>{likes}</span>
                    </button>
                    <button
                      className={`vote-button ${deseo.votos.find(v => v.usuario_id === user?.id)?.tipo === 'dislike' ? 'active' : ''}`}
                      onClick={() => handleVote(deseo.id, 'dislike')}
                    >
                      <ThumbsDown size={18} />
                      <span>{dislikes}</span>
                    </button>
                    <button
                      className={`vote-button ${deseo.votos.find(v => v.usuario_id === user?.id)?.tipo === 'revision' ? 'active' : ''}`}
                      onClick={() => handleVote(deseo.id, 'revision')}
                    >
                      <Clock size={18} />
                      <span>{revision}</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="wish-details">
                      <div className="wish-comments">
                        <h4>
                          <MessageSquare size={16} />
                          Comentarios ({deseo.comentarios.length})
                        </h4>
                        {deseo.comentarios.length === 0 ? (
                          <p className="no-comments">Aún no hay comentarios</p>
                        ) : (
                          <div className="comments-list">
                            {deseo.comentarios.map((comentario) => (
                              <div key={comentario.id} className="comment">
                                <span className="comment-author">
                                  {comentario.usuario_id === user?.id ? 'Tú' : 'Miembro'}
                                </span>
                                <p>{comentario.texto}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = e.target as HTMLFormElement;
                            const input = form.elements.namedItem('comment') as HTMLInputElement;
                            if (input.value.trim()) {
                              handleAddComment(deseo.id, input.value.trim());
                              input.value = '';
                            }
                          }}
                          className="comment-form"
                        >
                          <input
                            name="comment"
                            type="text"
                            placeholder="Deja un comentario..."
                            required
                          />
                          <button type="submit" className="button primary">
                            Enviar
                          </button>
                        </form>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (view === 'create-wish') {
    return (
      <div className="page">
        <header className="page-header">
          <button
            className="icon-button"
            onClick={() => setView('team-detail')}
          >
            <ChevronDown size={24} />
          </button>
          <h1>Crear Deseo</h1>
        </header>

        <Card>
          <form onSubmit={handleCreateWish} className="form">
            <div className="form-group">
              <label htmlFor="wish-title">¿Qué quieres comprar?</label>
              <input
                id="wish-title"
                type="text"
                placeholder="Ej: Viaje a París, Nueva laptop, etc."
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="wish-description">Descripción</label>
              <textarea
                id="wish-description"
                placeholder="Cuéntanos más sobre este deseo..."
                rows={3}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="wish-amount">Monto objetivo</label>
              <input
                id="wish-amount"
                type="number"
                placeholder="0"
                min="0.01"
                step="0.01"
                required
              />
            </div>

            <button type="submit" className="button primary full-width" disabled={busy || !account}>
              {busy ? 'Guardando…' : 'Crear Deseo'}
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return null;
}
