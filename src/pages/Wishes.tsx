import { useState, useMemo, useEffect, type FormEvent } from "react";
import { Star, Plus, Users, Wallet, ThumbsUp, ThumbsDown, Clock, MessageSquare, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useDrip } from "../context";
import { Card, Empty } from "../components/ui";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import * as client from "../api/client";
import type { Team, Deseo, VotoTipo, TeamWallet } from "../types";

export default function Wishes() {
  const { user } = useAuth();
  const settings = useSettings();
  const { toast } = useDrip();
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

  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [deseos, setDeseos] = useState<Deseo[]>([]);
  const [wallet, setWallet] = useState<TeamWallet | null>(null);

  const loadDeseos = async (teamId: string) => {
    if (settings.isDemo || !account) return;
    try {
      const response = await client.request<{ deseos?: Deseo[]; team_wallets?: TeamWallet[] }>(account, { action: 'list' });
      if (response.deseos) {
        const teamDeseos = response.deseos.filter((d: Deseo) => d.team_id === teamId);
        setDeseos(teamDeseos);
      }
      if (response.team_wallets) {
        const teamWallet = response.team_wallets.find((w) => w.team_id === teamId);
        setWallet(teamWallet || null);
      }
    } catch (error) {
      console.error('Error loading deseos:', error);
    }
  };

  const loadTeams = async () => {
    if (settings.isDemo || !account) return;
    setLoadingTeams(true);
    try {
      const response = await client.request<{ teams?: Team[] }>(account, { action: 'list' });
      if (response.teams) setTeams(response.teams);
    } catch (error) {
      console.error('Error loading teams:', error);
    } finally {
      setLoadingTeams(false);
    }
  };

  useEffect(() => {
    loadTeams();
  }, [account, settings.isDemo]);

  useEffect(() => {
    if (selectedTeam && !settings.isDemo) {
      loadDeseos(selectedTeam.id);
    }
  }, [selectedTeam, settings.isDemo]);

  // Datos demo para modo demo
  const demoDeseos = useMemo(() => {
    if (settings.isDemo && selectedTeam) {
      return [
        {
          id: 'wish-1',
          team_id: selectedTeam.id,
          titulo: 'Entradas Museo Louvre',
          descripcion: 'Quiero visitar el museo y ver la Mona Lisa',
          monto_objetivo: 500000,
          monto_actual: 200000,
          creador_id: 'demo-user',
          creado_en: '2026-01-01T00:00:00.000Z',
          actualizado_en: '2026-01-01T00:00:00.000Z',
          eliminado: false,
          votos: [
            { id: 'v1', usuario_id: 'demo-user', tipo: 'like', creado_en: '2026-01-01T00:00:00.000Z' },
            { id: 'v2', usuario_id: 'user-2', tipo: 'like', creado_en: '2026-01-01T00:00:00.000Z' },
          ],
          comentarios: [],
          aprobado: true,
        },
        {
          id: 'wish-2',
          team_id: selectedTeam.id,
          titulo: 'Cena en Torre Eiffel',
          descripcion: 'Cena romántica con vista a la torre',
          monto_objetivo: 800000,
          monto_actual: 0,
          creador_id: 'user-2',
          creado_en: '2026-01-01T00:00:00.000Z',
          actualizado_en: '2026-01-01T00:00:00.000Z',
          eliminado: false,
          votos: [
            { id: 'v3', usuario_id: 'demo-user', tipo: 'revision', creado_en: '2026-01-01T00:00:00.000Z' },
          ],
          comentarios: [
            { id: 'c1', usuario_id: 'demo-user', texto: '¿Podemos buscar algo más económico?', creado_en: '2026-01-01T00:00:00.000Z' },
          ],
          aprobado: false,
        },
      ] as Deseo[];
    }
    return [] as Deseo[];
  }, [settings.isDemo, selectedTeam]);

  const demoWallet = useMemo(() => {
    if (settings.isDemo && selectedTeam) {
      return {
        team_id: selectedTeam.id,
        saldo: 200000,
        creado_en: '2026-01-01T00:00:00.000Z',
        actualizado_en: '2026-01-01T00:00:00.000Z',
      };
    }
    return null;
  }, [settings.isDemo, selectedTeam]);

  // Usar datos demo o datos reales
  const displayDeseos = settings.isDemo ? demoDeseos : deseos;
  const displayWallet = settings.isDemo ? demoWallet : wallet;

  const handleCreateTeam = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !account) {
      toast('Debes estar autenticado para crear un Team');
      return;
    }
    const form = e.target as HTMLFormElement;
    const nombre = (form.elements.namedItem('team-name') as HTMLInputElement).value;
    const correo = (form.elements.namedItem('invite-email') as HTMLInputElement).value;

    try {
      const team = await client.createTeam(account, nombre, user.id);
      if (correo) {
        await client.inviteToTeam(account, team.id, correo, user.id);
      }
      toast('Team creado exitosamente');
      setView('teams');
      form.reset();
    } catch (error) {
      toast('Error al crear el Team: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
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

    try {
      await client.createWish(account, selectedTeam.id, titulo, descripcion, montoObjetivo, user.id);
      toast('Deseo creado exitosamente');
      setView('team-detail');
      form.reset();
    } catch (error) {
      toast('Error al crear el Deseo: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
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

  const handleAddToWallet = async () => {
    if (!user || !account || !selectedTeam) {
      toast('Debes estar autenticado');
      return;
    }
    const monto = prompt('¿Cuánto deseas agregar a la cartera?');
    if (!monto) return;
    try {
      await client.addToWallet(account, selectedTeam.id, Number(monto), user.id);
      toast('Dinero agregado a la cartera');
    } catch (error) {
      toast('Error al agregar a la cartera: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  const handleWithdrawFromWallet = async () => {
    if (!user || !account || !selectedTeam) {
      toast('Debes estar autenticado');
      return;
    }
    const monto = prompt('¿Cuánto deseas retirar de la cartera?');
    if (!monto) return;
    try {
      await client.withdrawFromWallet(account, selectedTeam.id, Number(monto), user.id);
      toast('Dinero retirado de la cartera');
    } catch (error) {
      toast('Error al retirar de la cartera: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  if (view === 'teams') {
    return (
      <div className="page">
        <header className="page-header">
          <h1>
            <Star size={24} />
            Deseos
          </h1>
          <button
            className="button primary"
            onClick={() => setView('create-team')}
          >
            <Plus size={18} />
            Crear Team
          </button>
        </header>

        {loadingTeams ? (
          <p className="text-center">Cargando teams...</p>
        ) : teams.length === 0 ? (
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
              <label htmlFor="invite-email">Invitar por correo</label>
              <input
                id="invite-email"
                type="email"
                placeholder="correo@ejemplo.com"
              />
              <small className="form-hint">
                Solo puedes invitar usuarios registrados en la base de datos
              </small>
            </div>

            <button type="submit" className="button primary full-width">
              Crear Team
            </button>
          </form>
        </Card>
      </div>
    );
  }

  if (view === 'team-detail' && selectedTeam) {
    const teamDeseos = displayDeseos.filter(d => d.team_id === selectedTeam.id);
    const isAdmin = selectedTeam.creador_id === user?.id;
    const currentWallet = displayWallet;

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
              <h2>Cartera del Team</h2>
            </div>
            <div className="wallet-balance">
              <span className="wallet-amount">
                ${currentWallet.saldo.toLocaleString()}
              </span>
              <span className="wallet-label">disponibles</span>
            </div>
            <div className="wallet-actions">
              <button
                className="button primary"
                onClick={handleAddToWallet}
              >
                <Plus size={16} />
                Registrar ingreso
              </button>
              {isAdmin && (
                <button
                  className="button secondary"
                  onClick={handleWithdrawFromWallet}
                >
                  <Trash2 size={16} />
                  Retirar
                </button>
              )}
            </div>
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
              const progress = (deseo.monto_actual / deseo.monto_objetivo) * 100;

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
                min="0"
                required
              />
            </div>

            <button type="submit" className="button primary full-width">
              Crear Deseo
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return null;
}
