const SPREADSHEET_ID = '1Qzzvv2ObVMYdN9rQRSHYEwEdhlfKH262nM0trH4YBpY'; /*NO MODIFICAR*/
const SHEET_NAME = 'Registros';
const TIMEZONE = 'America/Bogota';
const API_VERSION = 'Drip_API:V:0.0.0.07';

/* Drip — Daily Records for Individuals & Partners.
 * Único archivo del backend. Publicar como Web App: ejecutar como Yo,
 * acceso Cualquier usuario. Los intereses son porcentajes: tasa_interes_mensual = 2 significa 2 %.
 * Desde V:0.0.0.03 ya no existe un token de dispositivo: cada persona se
 * identifica únicamente con su correo y contraseña, guardados y validados en Usuarios.
 */
const HEADERS_ = {
  registros: ['id', 'fecha', 'tipo', 'subtipo', 'monto', 'categoria', 'tags', 'descripcion', 'metodo_pago', 'necesidad', 'recurrente_id', 'deuda_id', 'creado_en', 'actualizado_en', 'eliminado', 'usuario_id'],
  categorias: ['id', 'nombre', 'tipo', 'color', 'icono', 'presupuesto_mensual', 'activa'],
  deudas: ['id', 'nombre', 'acreedor', 'monto_inicial', 'tasa_interes_mensual', 'fecha_inicio', 'cuota_minima', 'dia_pago', 'activa'],
  recurrentes: ['id', 'descripcion', 'monto', 'categoria', 'tags', 'frecuencia', 'dia', 'proximo_pago', 'metodo_pago', 'activa'],
  config: ['clave', 'valor'],
  usuarios: ['id', 'nombre', 'correo', 'password_hash', 'salt', 'creado_en'],
  teams: ['id', 'nombre', 'creador_id', 'miembros', 'creado_en', 'actualizado_en', 'activo'],
  deseos: ['id', 'team_id', 'titulo', 'descripcion', 'monto_objetivo', 'monto_actual', 'creador_id', 'creado_en', 'actualizado_en', 'eliminado', 'aprobado'],
  votos: ['id', 'deseo_id', 'usuario_id', 'tipo', 'creado_en'],
  comentarios: ['id', 'deseo_id', 'usuario_id', 'texto', 'creado_en'],
  team_wallets: ['team_id', 'saldo', 'creado_en', 'actualizado_en']
};
const TABLE_NAMES_ = { registros: SHEET_NAME, categorias: 'Categorias', deudas: 'Deudas', recurrentes: 'Recurrentes', config: 'Config', usuarios: 'Usuarios', teams: 'Teams', deseos: 'Deseos', votos: 'Votos', comentarios: 'Comentarios', team_wallets: 'TeamWallets' };
const DEFAULT_CONFIG_ = { moneda: 'COP', umbral_hormiga: 20000, min_repeticiones_hormiga: 3, tipo_ciclo: 'auto', dia_corte: 1, excluir_fijos_de_racha: true, meta_reduccion_semanal_pct: 0 };
const TIPOS_ = ['ingreso', 'gasto', 'deuda_aumento', 'deuda_pago', 'sin_gasto'];
const METODOS_ = ['efectivo', 'debito', 'credito', 'transferencia', 'otro'];
const NUMERIC_FIELDS_ = ['monto', 'presupuesto_mensual', 'monto_inicial', 'tasa_interes_mensual', 'cuota_minima', 'dia_pago', 'dia', 'monto_objetivo', 'monto_actual', 'saldo'];
const BOOLEAN_FIELDS_ = ['activa', 'activo', 'eliminado', 'aprobado'];
const DATE_FIELDS_ = ['fecha', 'fecha_inicio', 'proximo_pago'];
var bookCache_;
// Solo durante esta petición: nunca se reutilizan datos financieros entre sesiones.
var tableCache_ = Object.create(null);
var sheetCache_ = Object.create(null);

function setup() {
  tableCache_ = Object.create(null);
  sheetCache_ = Object.create(null);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSchema_();
    Object.keys(TABLE_NAMES_).forEach(function (key) { formatSheet_(sheet_(TABLE_NAMES_[key]), key); });
    SpreadsheetApp.flush();
    return { ok: true, message: 'Drip ' + API_VERSION + ' está listo. Implementa como aplicación web y copia la URL /exec.' };
  } finally { lock.releaseLock(); }
}

// La prueba de vida no abre la hoja ni revela configuración, usuarios ni datos.
function doGet(e) { return json_({ ok: true, service: 'finanzas', version: API_VERSION }); }

function doPost(e) {
  tableCache_ = Object.create(null);
  sheetCache_ = Object.create(null);
  let lock;
  let acquired = false;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') throw apiError_('BAD_REQUEST', 'Falta el cuerpo JSON.');
    if (e.postData.contents.length > 1000000) throw apiError_('PAYLOAD_TOO_LARGE', 'La petición excede el límite de 1 MB.');
    let p;
    try { p = JSON.parse(e.postData.contents); } catch (err) { throw apiError_('BAD_JSON', 'El cuerpo debe ser JSON válido.'); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw apiError_('BAD_REQUEST', 'La petición debe ser un objeto.');
    const handlers = { list: handleList_, sync: handleSync_, upsert: handleUpsert_, batch: handleBatch_, delete: handleDelete_, saveEntity: handleSaveEntity_, saveConfig: handleSaveConfig_, materializeRecurrentes: handleMaterialize_, register: handleRegister_, login: handleLogin_, createTeam: handleCreateTeam_, inviteToTeam: handleInviteToTeam_, createWish: handleCreateWish_, deleteWish: handleDeleteWish_, voteWish: handleVoteWish_, addComment: handleAddComment_, contributeWish: handleContributeWish_, addToWallet: handleAddToWallet_, withdrawFromWallet: handleWithdrawFromWallet_ };
    if (!Object.prototype.hasOwnProperty.call(handlers, p.action)) throw apiError_('UNKNOWN_ACTION', 'Acción no reconocida.');
    // También bloqueamos las lecturas: esquema, semillas y cursor consistente
    // requieren escritura, y no se debe leer un batch parcialmente aplicado.
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    acquired = true;
    ensureSchema_();
    const result = handlers[p.action](p);
    // Confirma la escritura y lee el estado resultante bajo el mismo bloqueo.
    if (p.includeSnapshot === true && p.action !== 'list' && p.action !== 'sync' && p.action !== 'login' && p.action !== 'register') {
      return ok_({ result: result, snapshot: handleList_({}) });
    }
    return ok_(result);
  } catch (err) {
    // No devolvemos stacks, IDs de la hoja ni errores internos de Google.
    return fail_(err.apiCode || 'SERVER_ERROR', err.apiCode ? err.message : 'No se pudo completar la operación. Reintenta en un momento.');
  } finally { if (acquired && lock) lock.releaseLock(); }
}

function ensureSchema_() {
  const book = book_();
  const created = [];
  Object.keys(TABLE_NAMES_).forEach(function (key) {
    let sheet = book.getSheetByName(TABLE_NAMES_[key]);
    const headers = HEADERS_[key];
    if (!sheet) sheet = book.insertSheet(TABLE_NAMES_[key]);
    sheetCache_[TABLE_NAMES_[key]] = sheet;
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      created.push(key);
    } else {
      const width = sheet.getLastColumn();
      const current = sheet.getRange(1, 1, 1, Math.max(width, headers.length)).getValues()[0];
      // V:0.0.0.01 no tenía usuario_id: se agrega la columna sin tocar filas existentes.
      if (key === 'registros' && width === headers.length - 1 && headers.slice(0, -1).every(function (header, i) { return current[i] === header; })) {
        sheet.getRange(1, headers.length, 1, 1).setValues([[headers[headers.length - 1]]]);
      } else if (headers.some(function (header, i) { return current[i] !== header; })) {
        throw apiError_('SCHEMA_MISMATCH', 'Encabezados inesperados en ' + TABLE_NAMES_[key] + '. Conserva el orden documentado antes de continuar.');
      }
    }
  });
  // Primero existen todas las pestañas; así la validación de categorías
  // también queda instalada cuando el primer POST crea la hoja automáticamente.
  created.forEach(function (key) { formatSheet_(sheet_(TABLE_NAMES_[key]), key); });
  // No uses getLastRow(): la casilla de 'activa' deja FALSE en cientos de filas
  // vacías al formatear, e infla getLastRow() antes de sembrar las categorías.
  if (table_('categorias').length === 0) {
    const seeds = [
      ['sueldo', 'Sueldo', 'ingreso', '#10b981', 'Wallet'], ['extra', 'Ingreso extra', 'ingreso', '#34d399', 'Sparkles'],
      ['vivienda', 'Vivienda', 'gasto', '#6366f1', 'House'], ['servicios', 'Servicios', 'gasto', '#818cf8', 'Zap'],
      ['mercado', 'Mercado', 'gasto', '#14b8a6', 'ShoppingBasket'], ['comida', 'Comida fuera', 'gasto', '#f59e0b', 'Utensils'],
      ['transporte', 'Transporte', 'gasto', '#0ea5e9', 'Bus'], ['salud', 'Salud', 'gasto', '#f43f5e', 'HeartPulse'],
      ['educacion', 'Educación', 'gasto', '#8b5cf6', 'GraduationCap'], ['ocio', 'Ocio', 'gasto', '#a855f7', 'Gamepad2'],
      ['suscripciones', 'Suscripciones', 'gasto', '#ec4899', 'Repeat'], ['ropa', 'Ropa', 'gasto', '#d946ef', 'Shirt'],
      ['deudas', 'Deudas', 'gasto', '#ef4444', 'CreditCard'], ['ahorro', 'Ahorro', 'gasto', '#059669', 'PiggyBank'],
      ['otros', 'Otros', 'gasto', '#64748b', 'CircleEllipsis']
    ].map(function (row) { return ['cat-' + row[0], row[1], row[2], row[3], row[4], 0, true]; });
    sheet_('Categorias').getRange(2, 1, seeds.length, HEADERS_.categorias.length).setValues(seeds);
    delete tableCache_.categorias;
  }
  const existing = table_('config');
  const missing = Object.keys(DEFAULT_CONFIG_).filter(function (key) { return !existing.some(function (row) { return row.clave === key; }); });
  if (missing.length) {
    sheet_('Config').getRange(existing.length + 2, 1, missing.length, 2).setValues(missing.map(function (key) { return [key, DEFAULT_CONFIG_[key]]; }));
    delete tableCache_.config;
  }
}

function formatSheet_(sheet, key) {
  const headers = HEADERS_[key];
  const size = Math.max(1, sheet.getMaxRows() - 1);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setBackground('#4f46e5').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setColumnWidths(1, headers.length, 145);
  // Fechas y textos explícitos previenen conversiones automáticas de IDs/ISO.
  headers.forEach(function (field, index) {
    const range = sheet.getRange(2, index + 1, size, 1);
    if (NUMERIC_FIELDS_.indexOf(field) >= 0) range.setNumberFormat('#,##0.00');
    else if (BOOLEAN_FIELDS_.indexOf(field) < 0 && field !== 'valor') range.setNumberFormat('@');
  });
  const rules = key === 'registros' ? { tipo: TIPOS_, subtipo: ['sueldo', 'adicional', 'variable', 'fijo', ''], metodo_pago: METODOS_, necesidad: ['necesario', 'innecesario', ''] }
    : key === 'categorias' ? { tipo: ['ingreso', 'gasto'] }
      : key === 'recurrentes' ? { frecuencia: ['semanal', 'quincenal', 'mensual', 'anual'], metodo_pago: METODOS_ }
        : key === 'votos' ? { tipo: ['like', 'dislike', 'revision'] } : {};
  Object.keys(rules).forEach(function (field) {
    sheet.getRange(2, headers.indexOf(field) + 1, size, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(rules[field], true).setAllowInvalid(false).build());
  });
  if (key === 'registros' || key === 'recurrentes') {
    const categorySheet = book_().getSheetByName('Categorias');
    // Lista orientativa en Sheets para permitir renombrados en cascada; la API
    // siempre valida las referencias antes de escribir.
    if (categorySheet) sheet.getRange(2, headers.indexOf('categoria') + 1, size, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(categorySheet.getRange('B2:B'), true).setAllowInvalid(true).build());
  }
  headers.forEach(function (field, index) {
    if (BOOLEAN_FIELDS_.indexOf(field) >= 0) sheet.getRange(2, index + 1, size, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });
}

function handleList_(p) {
  const since = p.since ? iso_(p.since, 'since') : '';
  const votos = table_('votos');
  const comentarios = table_('comentarios');
  const votesByWish = Object.create(null);
  const commentsByWish = Object.create(null);
  votos.forEach(function (vote) { (votesByWish[vote.deseo_id] || (votesByWish[vote.deseo_id] = [])).push(vote); });
  comentarios.forEach(function (comment) { (commentsByWish[comment.deseo_id] || (commentsByWish[comment.deseo_id] = [])).push(comment); });
  const allRecords = table_('registros');
  return {
    apiVersion: API_VERSION, syncProtocol: 1,
    registros: allRecords.filter(function (row) { return !since || row.actualizado_en > since; }),
    categorias: table_('categorias'), deudas: table_('deudas'), recurrentes: table_('recurrentes'),
    config: config_(),
    // Estas colecciones son snapshots completos. since filtra solo Registros.
    // Sheets conserva miembros como JSON; la API lo expone siempre como arreglo.
    teams: table_('teams').map(publicTeam_),
    deseos: table_('deseos').map(function (wish) {
      const aportes = {};
      const markers = allRecords.filter(function (r) { return !r.eliminado && r.tipo === 'sin_gasto' && r.tags === 'deseo_aporte:' + wish.id; });
      markers.forEach(function (r) { aportes[r.usuario_id] = Math.round(((aportes[r.usuario_id] || 0) + r.monto) * 100) / 100; });
      return Object.assign({}, wish, { aportes: aportes, monto_actual: markers.length ? markers.reduce(function (n, r) { return n + r.monto; }, 0) : wish.monto_actual, votos: votesByWish[wish.id] || [], comentarios: commentsByWish[wish.id] || [] }); }),
    votos: votos, comentarios: comentarios, team_wallets: table_('team_wallets'),
    serverTime: nowIso_()
  };
}

function teamMembers_(team) {
  let values = team.miembros;
  if (typeof values === 'string') {
    try { values = JSON.parse(values); } catch (error) { values = []; }
  }
  const members = Array.isArray(values) ? values.filter(function (value) { return typeof value === 'string' && value.trim(); }).map(function (value) { return value.trim(); }) : [];
  // El creador conserva su acceso si una fila antigua no lo incluyó.
  if (team.creador_id) members.unshift(String(team.creador_id));
  return Array.from(new Set(members));
}
function publicTeam_(team) { return Object.assign({}, team, { miembros: teamMembers_(team) }); }
function teamUser_(value) {
  if (!value) throw apiError_('UNAUTHORIZED', 'Debes ingresar para continuar.');
  const id = id_(value);
  if (!table_('usuarios').some(function (user) { return user.id === id; })) throw apiError_('USER_NOT_FOUND', 'El usuario no está registrado.');
  return id;
}
function memberTeam_(teamId, userId) {
  const team = table_('teams').find(function (row) { return row.id === id_(teamId) && row.activo; });
  if (!team) throw apiError_('NOT_FOUND', 'Team no encontrado o inactivo.');
  if (teamMembers_(team).indexOf(userId) < 0) throw apiError_('UNAUTHORIZED', 'No perteneces a este Team.');
  return team;
}
function ensureTeamWallet_(team) {
  const wallets = table_('team_wallets');
  const existing = wallets.find(function (wallet) { return wallet.team_id === team.id; });
  if (existing) return existing;
  const stamp = nowIso_();
  const wallet = { team_id: team.id, saldo: 0, creado_en: stamp, actualizado_en: stamp };
  wallets.push(wallet);
  writeChanges_('team_wallets', wallets, [wallets.length - 1]);
  return wallet;
}
function handleCreateTeam_(p) {
  const creator = teamUser_(p.usuario_id);
  const nombre = text_(p.nombre, 'nombre', 100, true);
  const id = p.id ? id_(p.id) : uuid_();
  const rows = table_('teams');
  const existing = rows.find(function (team) { return team.id === id; });
  if (existing) {
    if (existing.creador_id !== creator) throw apiError_('UNAUTHORIZED', 'El Team pertenece a otro creador.');
    ensureTeamWallet_(existing);
    return publicTeam_(existing);
  }
  // Resuelve todos los correos antes de crear el equipo: un correo inválido
  // no deja un equipo parcial que el siguiente intento pudiera duplicar.
  const invited = invitedUsers_(p.correos || []);
  const stamp = nowIso_();
  const team = { id: id, nombre: nombre, creador_id: creator, miembros: JSON.stringify(Array.from(new Set([creator].concat(invited)))), creado_en: stamp, actualizado_en: stamp, activo: true };
  rows.push(team);
  writeChanges_('teams', rows, [rows.length - 1]);
  ensureTeamWallet_(team);
  return publicTeam_(team);
}
function invitedUsers_(value) {
  const values = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(values) || values.length > 50) throw apiError_('VALIDATION_ERROR', 'Escribe hasta 50 correos separados por comas.');
  const emails = Array.from(new Set(values.map(email_)));
  const users = table_('usuarios');
  return emails.map(function (correo) {
    const user = users.find(function (row) { return row.correo.toLocaleLowerCase() === correo; });
    if (!user) throw apiError_('USER_NOT_FOUND', 'El correo ' + correo + ' no está registrado.');
    return user.id;
  });
}
function handleInviteToTeam_(p) {
  const userId = teamUser_(p.usuario_id);
  const team = memberTeam_(p.team_id, userId);
  if (team.creador_id !== userId) throw apiError_('UNAUTHORIZED', 'Solo el creador puede invitar miembros.');
  const invited = invitedUsers_(p.correos || p.correo);
  const members = teamMembers_(team);
  const nextMembers = Array.from(new Set(members.concat(invited)));
  if (nextMembers.length !== members.length) {
    const wishes = table_('deseos').filter(function (w) { return w.team_id === team.id && !w.eliminado; });
    const funded = table_('registros').some(function (r) { return !r.eliminado && r.tipo === 'sin_gasto' && wishes.some(function (w) { return r.tags === 'deseo_aporte:' + w.id; }); });
    if (funded) throw apiError_('VALIDATION_ERROR', 'Este Team ya tiene aportes. Crea otro Team para cambiar los participantes sin alterar las cuotas.');
    team.miembros = JSON.stringify(nextMembers); team.actualizado_en = nowIso_();
    const rows = table_('teams'); const index = rows.findIndex(function (row) { return row.id === team.id; });
    rows[index] = team; writeChanges_('teams', rows, [index]);
  }
  return publicTeam_(team);
}
function handleCreateWish_(p) {
  const creator = teamUser_(p.usuario_id);
  const team = memberTeam_(p.team_id, creator);
  const titulo = text_(p.titulo, 'titulo', 200, true);
  const descripcion = text_(p.descripcion || '', 'descripcion', 500, false);
  const goal = number_(p.monto_objetivo, 'monto_objetivo', 0.01, 1000000000000);
  const id = p.id ? id_(p.id) : uuid_();
  const rows = table_('deseos');
  const existing = rows.find(function (wish) { return wish.id === id; });
  if (existing) {
    if (existing.creador_id !== creator || existing.team_id !== team.id) throw apiError_('UNAUTHORIZED', 'El deseo pertenece a otro Team o creador.');
    return Object.assign({}, existing, { votos: table_('votos').filter(function (v) { return v.deseo_id === id; }), comentarios: table_('comentarios').filter(function (c) { return c.deseo_id === id; }) });
  }
  const stamp = nowIso_();
  const wish = { id: id, team_id: team.id, titulo: titulo, descripcion: descripcion, monto_objetivo: goal, monto_actual: 0, creador_id: creator, creado_en: stamp, actualizado_en: stamp, eliminado: false, aprobado: false };
  rows.push(wish); writeChanges_('deseos', rows, [rows.length - 1]);
  return Object.assign({}, wish, { votos: [], comentarios: [] });
}
function memberWish_(wishId, userId) {
  const rows = table_('deseos');
  const index = rows.findIndex(function (wish) { return wish.id === id_(wishId) && !wish.eliminado; });
  if (index < 0) throw apiError_('NOT_FOUND', 'Deseo no encontrado.');
  return { rows: rows, index: index, wish: rows[index], team: memberTeam_(rows[index].team_id, userId) };
}
// Soft deletion keeps recorded money and audit history intact.
function handleDeleteWish_(p) {
  const userId = teamUser_(p.usuario_id);
  const rows = table_('deseos');
  const index = rows.findIndex(function (wish) { return wish.id === id_(p.deseo_id); });
  if (index < 0) throw apiError_('NOT_FOUND', 'Deseo no encontrado.');
  const wish = rows[index];
  const team = memberTeam_(wish.team_id, userId);
  if (wish.creador_id !== userId && team.creador_id !== userId) throw apiError_('UNAUTHORIZED', 'Solo el creador del deseo o del Team puede eliminarlo.');
  if (!wish.eliminado) {
    wish.eliminado = true; wish.actualizado_en = nowIso_();
    writeChanges_('deseos', rows, [index]);
  }
  return { deseo_id: wish.id, eliminado: true };
}

function handleVoteWish_(p) {
  const userId = teamUser_(p.usuario_id);
  const ctx = memberWish_(p.deseo_id, userId);
  const tipo = enum_(p.tipo, ['like', 'dislike', 'revision'], 'tipo');
  const votes = table_('votos');
  let index = votes.findIndex(function (vote) { return vote.deseo_id === ctx.wish.id && vote.usuario_id === userId; });
  if (index < 0) index = votes.length;
  votes[index] = { id: votes[index] ? votes[index].id : uuid_(), deseo_id: ctx.wish.id, usuario_id: userId, tipo: tipo, creado_en: nowIso_() };
  writeChanges_('votos', votes, [index]);
  const members = teamMembers_(ctx.team);
  const approved = members.length > 0 && members.every(function (member) { return votes.some(function (vote) { return vote.deseo_id === ctx.wish.id && vote.usuario_id === member && vote.tipo === 'like'; }); });
  ctx.wish.aprobado = approved; ctx.wish.actualizado_en = nowIso_();
  writeChanges_('deseos', ctx.rows, [ctx.index]);
  return { deseo_id: ctx.wish.id, tipo: tipo, aprobado: approved };
}
function handleAddComment_(p) {
  const userId = teamUser_(p.usuario_id);
  const ctx = memberWish_(p.deseo_id, userId);
  const texto = text_(p.texto, 'texto', 1000, true);
  const id = p.id ? id_(p.id) : uuid_();
  const rows = table_('comentarios');
  const existing = rows.find(function (comment) { return comment.id === id; });
  if (existing) {
    if (existing.usuario_id !== userId || existing.deseo_id !== ctx.wish.id) throw apiError_('UNAUTHORIZED', 'El comentario pertenece a otro miembro.');
    return existing;
  }
  const comment = { id: id, deseo_id: ctx.wish.id, usuario_id: userId, texto: texto, creado_en: nowIso_() };
  rows.push(comment); writeChanges_('comentarios', rows, [rows.length - 1]);
  return comment;
}

// Contributions are journaled with deterministic IDs under the script lock.
// The owner books the entire budget once; invited members book their own share.
function handleContributeWish_(p) {
  const userId = teamUser_(p.usuario_id);
  const ctx = memberWish_(p.deseo_id, userId);
  const amount = number_(p.monto, 'monto', 0.01, 1000000000000);
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw apiError_('VALIDATION_ERROR', 'El aporte admite hasta dos decimales.');
  const operationId = id_(p.id);
  const markerId = 'wish-contribution-' + operationId;
  const rows = table_('registros');
  const tag = 'deseo_aporte:' + ctx.wish.id;
  const existing = rows.find(function (r) { return r.id === markerId; });
  if (existing) {
    if (existing.usuario_id !== userId || existing.tags !== tag || existing.monto !== amount) throw apiError_('VALIDATION_ERROR', 'El ID del aporte ya fue utilizado.');
    return { deseo_id: ctx.wish.id };
  }
  const members = teamMembers_(ctx.team);
  const votes = table_('votos');
  if (!members.every(function (m) { return votes.some(function (v) { return v.deseo_id === ctx.wish.id && v.usuario_id === m && v.tipo === 'like'; }); })) throw apiError_('VALIDATION_ERROR', 'Todos deben aprobar el deseo antes de aportar.');
  const totalCents = Math.round(ctx.wish.monto_objetivo * 100);
  const ordered = members.slice().sort();
  const quota = (Math.floor(totalCents / ordered.length) + (ordered.indexOf(userId) < totalCents % ordered.length ? 1 : 0)) / 100;
  const markers = rows.filter(function (r) { return !r.eliminado && r.tipo === 'sin_gasto' && r.tags === tag; });
  if (!markers.length && ctx.wish.monto_actual > 0) throw apiError_('VALIDATION_ERROR', 'Este deseo tiene aportes históricos sin detalle por persona. Revisa esos aportes antes de usar el nuevo flujo.');
  const paid = markers.filter(function (r) { return r.usuario_id === userId; }).reduce(function (n, r) { return n + r.monto; }, 0);
  if (Math.round((paid + amount) * 100) > Math.round(quota * 100)) throw apiError_('VALIDATION_ERROR', 'El aporte supera tu cuota pendiente.');
  const categories = table_('categorias');
  const expense = categories.find(function (c) { return c.tipo === 'gasto' && c.activa; });
  const income = categories.find(function (c) { return c.tipo === 'ingreso' && c.activa; });
  if (!expense || !income) throw apiError_('VALIDATION_ERROR', 'Debes tener categorías activas de ingreso y gasto.');
  const stamp = nowIso_();
  const date = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const touched = [];
  function append(id, type, value, owner, tags) {
    if (rows.some(function (r) { return r.id === id; })) return;
    rows.push({ id: id, fecha: date, tipo: type, subtipo: type === 'ingreso' ? 'adicional' : type === 'gasto' ? 'variable' : '', monto: value,
      categoria: type === 'ingreso' ? income.nombre : expense.nombre, tags: tags, descripcion: 'Deseo: ' + ctx.wish.titulo,
      metodo_pago: 'transferencia', necesidad: type === 'gasto' ? 'necesario' : '', recurrente_id: '', deuda_id: '',
      creado_en: stamp, actualizado_en: stamp, eliminado: false, usuario_id: owner });
    touched.push(rows.length - 1);
  }
  if (userId === ctx.wish.creador_id) {
    append('wish-budget-' + ctx.wish.id, 'gasto', ctx.wish.monto_objetivo, userId, 'deseo_presupuesto:' + ctx.wish.id);
  } else {
    append(markerId + '-expense', 'gasto', amount, userId, 'deseo_transferencia:' + ctx.wish.id);
    append(markerId + '-income', 'ingreso', amount, ctx.wish.creador_id, 'deseo_transferencia:' + ctx.wish.id);
  }
  append(markerId, 'sin_gasto', amount, userId, tag);
  writeChanges_('registros', rows, touched);
  ctx.wish.monto_actual = Math.round((markers.reduce(function (n, r) { return n + r.monto; }, 0) + amount) * 100) / 100;
  ctx.wish.actualizado_en = stamp;
  writeChanges_('deseos', ctx.rows, [ctx.index]);
  return { deseo_id: ctx.wish.id };
}

function handleAddToWallet_(p) { return changeTeamWallet_(p, false); }
function handleWithdrawFromWallet_(p) { return changeTeamWallet_(p, true); }
function changeTeamWallet_(p, withdraw) {
  const userId = teamUser_(p.usuario_id);
  const team = memberTeam_(p.team_id, userId);
  if (withdraw && team.creador_id !== userId) throw apiError_('UNAUTHORIZED', 'Solo el creador puede retirar de la cartera.');
  const amount = number_(p.monto, 'monto', 0.01, 1000000000000);
  const rows = table_('team_wallets');
  const index = rows.findIndex(function (wallet) { return wallet.team_id === team.id; });
  if (index < 0) throw apiError_('NOT_FOUND', 'La cartera del Team no existe.');
  if (withdraw && rows[index].saldo < amount) throw apiError_('INSUFFICIENT_FUNDS', 'Saldo insuficiente en la cartera.');
  const next = rows[index].saldo + (withdraw ? -amount : amount);
  number_(next, 'saldo', 0, 1000000000000);
  rows[index].saldo = Math.round(next * 100) / 100; rows[index].actualizado_en = nowIso_();
  writeChanges_('team_wallets', rows, [index]);
  return rows[index];
}

function handleUpsert_(p) {
  const result = applyOperations_([{ action: 'upsert', registro: p.registro }]);
  return result.registros[0];
}

function handleDelete_(p) {
  const result = applyOperations_([{ action: 'delete', id: p.id, actualizado_en: p.actualizado_en }]);
  // Eliminar un ID inexistente es un no-op idempotente.
  return result.registros[0] || { id: id_(p.id), eliminado: true, actualizado_en: result.serverTime };
}

function handleBatch_(p) {
  if (!Array.isArray(p.operations) || p.operations.length > 250) throw apiError_('VALIDATION_ERROR', 'operations debe ser un arreglo de hasta 250 operaciones.');
  return applyOperations_(p.operations);
}

function handleSync_(p) {
  if (!Array.isArray(p.operations) || p.operations.length > 250) throw apiError_('VALIDATION_ERROR', 'operations debe ser un arreglo de hasta 250 operaciones.');
  const categories = table_('categorias');
  const previous = Array.isArray(p.categorias) ? p.categorias : [];
  const operations = p.operations.map(function (op) {
    if (!op || op.action !== 'upsert' || !op.registro) return op;
    const row = Object.assign({}, op.registro);
    const tipo = row.tipo === 'ingreso' ? 'ingreso' : 'gasto';
    const old = previous.find(function (category) { return category.nombre === row.categoria; });
    const renamed = old && categories.find(function (category) { return category.id === old.id && category.tipo === tipo; });
    if (renamed) row.categoria = renamed.nombre;
    return { action: 'upsert', registro: row };
  });
  const result = applyOperations_(operations);
  return Object.assign(result, { snapshot: handleList_({}) });
}

function applyOperations_(operations) {
  const rows = table_('registros');
  const original = Object.create(null);
  const byId = Object.create(null);
  rows.forEach(function (row, i) { byId[row.id] = i; original[row.id] = row.actualizado_en; });
  const ctx = context_();
  const touched = Object.create(null);
  const returned = Object.create(null);
  // Valida todo sobre una copia en memoria antes de escribir una sola fila.
  // Dentro del batch compara las fechas CLIENTE aceptadas, sin que las nuevas
  // fechas de servidor oculten una edición posterior todavía en la cola.
  operations.forEach(function (op) {
    if (!op || (op.action !== 'upsert' && op.action !== 'delete')) throw apiError_('VALIDATION_ERROR', 'Solo se permiten upsert y delete en batch.');
    const id = id_(op.action === 'upsert' && op.registro ? op.registro.id : op.id);
    if (/^wish-(contribution|budget)-/.test(id)) throw apiError_('VALIDATION_ERROR', 'Los movimientos de deseos se gestionan desde el deseo.');
    const index = byId[id];
    const previous = index === undefined ? null : rows[index];
    const rawStamp = op.action === 'upsert' && op.registro ? op.registro.actualizado_en : op.actualizado_en;
    const clientStamp = rawStamp ? iso_(rawStamp, 'actualizado_en') : '';
    if (clientStamp && new Date(clientStamp).getTime() > Date.now() + 300000) throw apiError_('CLOCK_SKEW', 'La fecha del dispositivo está adelantada. Ajusta el reloj y reintenta.');
    let next;
    if (op.action === 'upsert') next = validate_(op.registro, ctx);
    if (previous && clientStamp && clientStamp <= (original[id] || '')) { returned[id] = previous; return; }
    if (op.action === 'delete' && !previous) return;
    // Reintentar una creación sin fecha de edición no debe revivir tombstones.
    if (previous && previous.eliminado && !clientStamp && op.action === 'upsert') { returned[id] = previous; return; }
    const stamp = nowIso_(clientStamp);
    if (op.action === 'delete') next = Object.assign({}, previous, { eliminado: true, actualizado_en: stamp });
    else next = Object.assign(next, { creado_en: previous ? previous.creado_en : stamp, actualizado_en: stamp,
      usuario_id: previous && previous.usuario_id ? previous.usuario_id : next.usuario_id });
    const nextIndex = index === undefined ? rows.length : index;
    byId[id] = nextIndex;
    rows[nextIndex] = next;
    original[id] = clientStamp || original[id] || '';
    touched[nextIndex] = true;
    returned[id] = next;
  });
  writeChanges_('registros', rows, Object.keys(touched).map(Number));
  return { registros: Object.keys(returned).map(function (id) { return returned[id]; }), serverTime: nowIso_() };
}

function handleSaveEntity_(p) {
  enum_(p.entity, ['categoria', 'deuda', 'recurrente'], 'entity');
  const key = { categoria: 'categorias', deuda: 'deudas', recurrente: 'recurrentes' }[p.entity];
  if (!key) throw apiError_('VALIDATION_ERROR', 'entity debe ser categoria, deuda o recurrente.');
  const obj = validateEntity_(p.entity, p.data, context_());
  const rows = table_(key);
  let index = rows.findIndex(function (row) { return row.id === obj.id; });
  if (p.entity === 'categoria' && rows.some(function (row) { return row.id !== obj.id && row.nombre.toLocaleLowerCase() === obj.nombre.toLocaleLowerCase(); })) throw apiError_('DUPLICATE_CATEGORY', 'Ya existe una categoría con ese nombre.');
  const previous = index < 0 ? null : rows[index];
  let records = [];
  let recurring = [];
  let changedRecords = [];
  let changedRecurring = [];
  if (p.entity === 'categoria' && previous) {
    records = table_('registros'); recurring = table_('recurrentes');
    if (previous.tipo !== obj.tipo && (records.some(function (r) { return r.categoria === previous.nombre; }) || recurring.some(function (r) { return r.categoria === previous.nombre; }))) throw apiError_('ENTITY_IN_USE', 'No puedes cambiar el tipo de una categoría utilizada. Crea otra categoría.');
    if (previous.nombre !== obj.nombre) {
      records.forEach(function (r, i) { if (r.categoria === previous.nombre) { r.categoria = obj.nombre; r.actualizado_en = nowIso_(); changedRecords.push(i); } });
      recurring.forEach(function (r, i) { if (r.categoria === previous.nombre) { r.categoria = obj.nombre; changedRecurring.push(i); } });
    }
  }
  if (index < 0) index = rows.length;
  rows[index] = obj;
  // La entidad se escribe al final para que un reintento pueda completar una
  // cascada interrumpida usando todavía el nombre anterior como referencia.
  writeChanges_('registros', records, changedRecords);
  writeChanges_('recurrentes', recurring, changedRecurring);
  writeChanges_(key, rows, [index]);
  return obj;
}

function handleSaveConfig_(p) {
  if (!p.config || typeof p.config !== 'object' || Array.isArray(p.config)) throw apiError_('VALIDATION_ERROR', 'Falta el objeto config.');
  Object.keys(p.config).forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG_, key)) throw apiError_('VALIDATION_ERROR', 'Clave de configuración desconocida: ' + key); });
  const next = Object.assign({}, config_(), p.config);
  next.moneda = text_(next.moneda, 'moneda', 3, true).toUpperCase();
  if (!/^[A-Z]{3}$/.test(next.moneda)) throw apiError_('VALIDATION_ERROR', 'moneda debe ser un código de tres letras, por ejemplo COP.');
  next.umbral_hormiga = number_(next.umbral_hormiga, 'umbral_hormiga', 0, 1000000000000);
  next.min_repeticiones_hormiga = integer_(next.min_repeticiones_hormiga, 'min_repeticiones_hormiga', 1, 1000);
  next.tipo_ciclo = enum_(next.tipo_ciclo, ['auto', 'mensual', 'quincenal'], 'tipo_ciclo');
  next.dia_corte = integer_(next.dia_corte, 'dia_corte', 1, 31);
  next.excluir_fijos_de_racha = bool_(next.excluir_fijos_de_racha, 'excluir_fijos_de_racha');
  next.meta_reduccion_semanal_pct = number_(next.meta_reduccion_semanal_pct, 'meta_reduccion_semanal_pct', 0, 100);
  const rows = Object.keys(DEFAULT_CONFIG_).map(function (key) { return { clave: key, valor: next[key] }; });
  writeChanges_('config', rows, rows.map(function (_, i) { return i; }));
  return next;
}

function handleMaterialize_() {
  const templates = table_('recurrentes');
  const records = table_('registros');
  const existing = Object.create(null);
  // También cuentan los borrados: eliminar una ocurrencia no la vuelve a crear.
  records.forEach(function (r) { if (r.recurrente_id) existing[r.recurrente_id + '|' + r.fecha] = true; });
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const ctx = context_();
  const changedTemplates = [];
  const changedRecords = [];
  const generated = [];
  let processed = 0;
  templates.forEach(function (template, index) {
    if (!template.activa) return;
    validateEntity_('recurrente', template, ctx);
    let cursor = template.proximo_pago;
    const initial = cursor;
    // Se avanza solo lo procesado; backlogs grandes continúan en otra llamada.
    while (cursor <= today && processed < 500) {
      const key = template.id + '|' + cursor;
      if (!existing[key]) {
        const stamp = nowIso_();
        const row = validate_({ id: 'rec:' + template.id + ':' + cursor, fecha: cursor, tipo: 'gasto', subtipo: 'fijo', monto: template.monto, categoria: template.categoria, tags: template.tags, descripcion: template.descripcion, metodo_pago: template.metodo_pago, necesidad: 'necesario', recurrente_id: template.id, deuda_id: '', eliminado: false }, ctx);
        row.creado_en = stamp; row.actualizado_en = stamp;
        changedRecords.push(records.length); records.push(row); generated.push(row); existing[key] = true;
      }
      processed++;
      cursor = nextOccurrence_(cursor, template.frecuencia, template.dia);
    }
    if (cursor !== initial) { template.proximo_pago = cursor; changedTemplates.push(index); }
  });
  // Guardar registros primero hace seguros los reintentos tras fallo parcial.
  writeChanges_('registros', records, changedRecords);
  writeChanges_('recurrentes', templates, changedTemplates);
  return { registros: generated, recurrentes: templates, pending: templates.some(function (r) { return r.activa && r.proximo_pago <= today; }), serverTime: nowIso_() };
}

function handleRegister_(p) {
  const nombre = text_(p.nombre, 'nombre', 120, true);
  const correo = email_(p.correo);
  const password = password_(p.password);
  const rows = table_('usuarios');
  if (rows.some(function (row) { return row.correo === correo; })) throw apiError_('DUPLICATE_USER', 'Ya existe una cuenta con ese correo.');
  const salt = uuid_();
  const row = { id: uuid_(), nombre: nombre, correo: correo, password_hash: hashPassword_(password, salt), salt: salt, creado_en: nowIso_() };
  rows.push(row);
  writeChanges_('usuarios', rows, [rows.length - 1]);
  // Nunca se devuelve el hash, la sal ni el resto de la hoja de usuarios.
  return { id: row.id, nombre: row.nombre, correo: row.correo };
}

function handleLogin_(p) {
  const correo = email_(p.correo);
  const password = text_(p.password, 'password', 200, true);
  const user = table_('usuarios').find(function (row) { return row.correo === correo; });
  // Un mensaje genérico evita confirmar si el correo existe en el libro.
  if (!user || !sameToken_(hashPassword_(password, user.salt), user.password_hash)) throw apiError_('UNAUTHORIZED', 'Correo o contraseña incorrectos.');
  return { id: user.id, nombre: user.nombre, correo: user.correo };
}

function validate_(value, ctx) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError_('VALIDATION_ERROR', 'registro debe ser un objeto.');
  const row = {
    id: id_(value.id), fecha: date_(value.fecha, 'fecha'), tipo: enum_(value.tipo, TIPOS_, 'tipo'),
    subtipo: text_(value.subtipo == null ? '' : value.subtipo, 'subtipo', 20, false),
    monto: number_(value.monto, 'monto', 0, 1000000000000),
    categoria: text_(value.categoria == null ? '' : value.categoria, 'categoria', 80, false),
    tags: tags_(value.tags || ''), descripcion: text_(value.descripcion || '', 'descripcion', 500, false),
    metodo_pago: enum_(value.metodo_pago || 'otro', METODOS_, 'metodo_pago'),
    necesidad: text_(value.necesidad || '', 'necesidad', 20, false),
    recurrente_id: value.recurrente_id ? id_(value.recurrente_id) : '', deuda_id: value.deuda_id ? id_(value.deuda_id) : '',
    creado_en: '', actualizado_en: '', eliminado: value.eliminado === undefined ? false : bool_(value.eliminado, 'eliminado'),
    usuario_id: value.usuario_id ? id_(value.usuario_id) : ''
  };
  if (row.tipo === 'ingreso') enum_(row.subtipo, ['sueldo', 'adicional'], 'subtipo');
  else if (row.tipo === 'gasto') { enum_(row.subtipo, ['variable', 'fijo'], 'subtipo'); enum_(row.necesidad, ['necesario', 'innecesario'], 'necesidad'); }
  else if (row.subtipo !== '') throw apiError_('VALIDATION_ERROR', 'subtipo debe estar vacío para deudas y sin_gasto.');
  if (row.tipo !== 'gasto' && row.necesidad !== '') throw apiError_('VALIDATION_ERROR', 'necesidad solo aplica a gastos.');
  if (row.tipo === 'sin_gasto') {
    if (row.monto !== 0) throw apiError_('VALIDATION_ERROR', 'sin_gasto requiere monto 0.');
    if (!row.categoria) row.categoria = ctx.categorias.find(function (c) { return c.nombre === 'Otros'; }) ? 'Otros' : ctx.categorias[0].nombre;
  }
  // Clientes antiguos podían guardar "Deudas" tras renombrar esa categoría.
  if ((row.tipo === 'deuda_pago' || row.tipo === 'deuda_aumento') && !ctx.categorias.some(function (c) { return c.nombre === row.categoria && c.tipo === 'gasto'; })) {
    const debtCategory = ctx.categorias.find(function (c) { return c.id === 'cat-deudas' && c.tipo === 'gasto'; }) || ctx.categorias.find(function (c) { return c.tipo === 'gasto' && c.activa; });
    if (debtCategory) row.categoria = debtCategory.nombre;
  }
  const category = ctx.categorias.find(function (c) { return c.nombre === row.categoria; });
  if (!category) throw apiError_('VALIDATION_ERROR', 'La categoría no existe.');
  if ((row.tipo === 'ingreso' && category.tipo !== 'ingreso') || (row.tipo === 'gasto' && category.tipo !== 'gasto')) throw apiError_('VALIDATION_ERROR', 'El tipo de categoría no corresponde al movimiento.');
  if (row.tipo === 'deuda_aumento' || row.tipo === 'deuda_pago') {
    if (!row.deuda_id || !ctx.deudas.some(function (d) { return d.id === row.deuda_id; })) throw apiError_('VALIDATION_ERROR', 'Selecciona una deuda existente.');
  } else if (row.deuda_id) throw apiError_('VALIDATION_ERROR', 'deuda_id solo aplica a movimientos de deuda.');
  if (row.recurrente_id && (!ctx.recurrentes.some(function (r) { return r.id === row.recurrente_id; }) || row.tipo !== 'gasto' || row.subtipo !== 'fijo')) throw apiError_('VALIDATION_ERROR', 'La plantilla recurrente no existe o el movimiento no es un gasto fijo.');
  if (value.creado_en) iso_(value.creado_en, 'creado_en');
  if (value.actualizado_en) iso_(value.actualizado_en, 'actualizado_en');
  return row;
}

function validateEntity_(entity, value, ctx) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw apiError_('VALIDATION_ERROR', 'Falta el objeto data de la entidad.');
  const base = { id: id_(value.id), activa: value.activa === undefined ? true : bool_(value.activa, 'activa') };
  if (entity === 'categoria') {
    const color = text_(value.color, 'color', 7, true);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw apiError_('VALIDATION_ERROR', 'color debe ser hexadecimal de seis dígitos.');
    return Object.assign(base, { nombre: text_(value.nombre, 'nombre', 80, true), tipo: enum_(value.tipo, ['ingreso', 'gasto'], 'tipo'), color: color, icono: text_(value.icono || 'CircleEllipsis', 'icono', 40, true), presupuesto_mensual: 0 });
  }
  if (entity === 'deuda') return Object.assign(base, { nombre: text_(value.nombre, 'nombre', 100, true), acreedor: text_(value.acreedor || '', 'acreedor', 150, false), monto_inicial: number_(value.monto_inicial, 'monto_inicial', 0, 1000000000000), tasa_interes_mensual: number_(value.tasa_interes_mensual, 'tasa_interes_mensual', 0, 100), fecha_inicio: date_(value.fecha_inicio, 'fecha_inicio'), cuota_minima: number_(value.cuota_minima, 'cuota_minima', 0, 1000000000000), dia_pago: integer_(value.dia_pago, 'dia_pago', 1, 31) });
  if (base.id.length > 180) throw apiError_('VALIDATION_ERROR', 'El ID de una plantilla no debe superar 180 caracteres.');
  const category = text_(value.categoria, 'categoria', 80, true);
  if (!ctx.categorias.some(function (c) { return c.nombre === category && c.tipo === 'gasto'; })) throw apiError_('VALIDATION_ERROR', 'La categoría debe existir y ser de gasto.');
  return Object.assign(base, { descripcion: text_(value.descripcion, 'descripcion', 500, true), monto: number_(value.monto, 'monto', 0, 1000000000000), categoria: category, tags: tags_(value.tags || ''), frecuencia: enum_(value.frecuencia, ['semanal', 'quincenal', 'mensual', 'anual'], 'frecuencia'), dia: integer_(value.dia, 'dia', 1, 31), proximo_pago: date_(value.proximo_pago, 'proximo_pago'), metodo_pago: enum_(value.metodo_pago, METODOS_, 'metodo_pago') });
}

function context_() { return { categorias: table_('categorias'), deudas: table_('deudas'), recurrentes: table_('recurrentes') }; }
function config_() {
  const result = Object.assign({}, DEFAULT_CONFIG_);
  table_('config').forEach(function (row) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG_, row.clave)) return;
    const defaultValue = DEFAULT_CONFIG_[row.clave];
    result[row.clave] = typeof defaultValue === 'number' ? Number(row.valor) : typeof defaultValue === 'boolean' ? row.valor === true || String(row.valor).toLowerCase() === 'true' : String(row.valor);
  });
  return result;
}

function book_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'PEGA_AQUI_EL_ID_DE_TU_HOJA') throw apiError_('SERVER_NOT_CONFIGURED', 'Configura SPREADSHEET_ID en Apps Script.');
  if (!bookCache_) bookCache_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return bookCache_;
}
function sheet_(name) { const result = sheetCache_[name] || book_().getSheetByName(name); if (!result) throw apiError_('SCHEMA_MISMATCH', 'Falta una pestaña. Ejecuta setup().'); sheetCache_[name] = result; return result; }
// Una celda con casilla (activa/eliminado) sin escribir vale FALSE en Sheets, no '';
// sin esto, una fila nunca usada se confunde con una fila corrupta por tener datos.
function isBlankRow_(row, headers) {
  return row.every(function (value, i) { return BOOLEAN_FIELDS_.indexOf(headers[i]) >= 0 ? (value === '' || value === false) : value === ''; });
}
function table_(key) {
  if (tableCache_[key]) return JSON.parse(JSON.stringify(tableCache_[key]));
  const headers = HEADERS_[key];
  const rows = sheet_(TABLE_NAMES_[key]).getDataRange().getValues().slice(1);
  // No comprimir huecos: cambiaría los índices y podría sobrescribir otra fila.
  while (rows.length && isBlankRow_(rows[rows.length - 1], headers)) rows.pop();
  // 'id' (columna A, row[0]) es la clave que HEADERS_[key] espera en cada fila; blank === sin ID/clave.
  const eliminadoIndex = headers.indexOf('eliminado');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row[0]) continue;
    // Solo en Registros, una fila totalmente vacía (resto de columnas también vacías) se
    // trata como un borrado lógico en vez de bloquear la sincronización de todo el libro;
    // conserva su posición para no desplazar los índices de las demás filas.
    if (key !== 'registros' || !isBlankRow_(row, headers)) throw apiError_('SCHEMA_MISMATCH', 'Hay una fila sin ID/clave en ' + TABLE_NAMES_[key] + ' (fila ' + (i + 2) + '). Corrige la hoja antes de sincronizar.');
    row[0] = 'blank-row-' + (i + 2);
    if (eliminadoIndex >= 0) row[eliminadoIndex] = true;
  }
  const result = rows.map(function (row) { return rowToObj_(row, HEADERS_[key]); });
  tableCache_[key] = result;
  return JSON.parse(JSON.stringify(result));
}
function rowToObj_(row, headers) {
  const result = {};
  headers.forEach(function (field, index) {
    let value = row[index] == null ? '' : row[index];
    if (value instanceof Date) value = Utilities.formatDate(value, TIMEZONE, DATE_FIELDS_.indexOf(field) >= 0 ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    // ISO timestamps are always UTC; manually entered sheet dates use TIMEZONE.
    if ((field === 'creado_en' || field === 'actualizado_en') && row[index] instanceof Date) value = row[index].toISOString();
    if (BOOLEAN_FIELDS_.indexOf(field) >= 0) value = value === true || String(value).toLowerCase() === 'true';
    else if (NUMERIC_FIELDS_.indexOf(field) >= 0) value = Number(value) || 0;
    else if (typeof value === 'string' && /^'[=+\-@]/.test(value)) value = value.slice(1);
    result[field] = value;
  });
  return result;
}
function objToRow_(obj, headers) { return headers.map(function (field) { const value = obj[field] == null ? '' : obj[field]; return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value; }); }

// Agrupa filas contiguas; nunca llama setValue/getValue por celda.
function writeChanges_(key, rows, indexes) {
  if (!indexes.length) return;
  delete tableCache_[key];
  const unique = Array.from(new Set(indexes)).sort(function (a, b) { return a - b; });
  const sheet = sheet_(TABLE_NAMES_[key]);
  const needed = unique[unique.length - 1] + 2;
  if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  let start = unique[0]; let previous = start; let group = [objToRow_(rows[start], HEADERS_[key])];
  for (let i = 1; i < unique.length; i++) {
    const index = unique[i];
    if (index === previous + 1) group.push(objToRow_(rows[index], HEADERS_[key]));
    else { sheet.getRange(start + 2, 1, group.length, HEADERS_[key].length).setValues(group); start = index; group = [objToRow_(rows[index], HEADERS_[key])]; }
    previous = index;
  }
  sheet.getRange(start + 2, 1, group.length, HEADERS_[key].length).setValues(group);
}

function nextOccurrence_(date, frequency, day) {
  const parts = date.split('-').map(Number);
  let next;
  if (frequency === 'semanal' || frequency === 'quincenal') next = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + (frequency === 'semanal' ? 7 : 15)));
  else {
    const year = parts[0] + (frequency === 'anual' ? 1 : 0);
    const month = parts[1] - 1 + (frequency === 'mensual' ? 1 : 0);
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    next = new Date(Date.UTC(year, month, Math.min(day, last)));
  }
  return next.toISOString().slice(0, 10);
}
function text_(value, field, max, required) {
  if (typeof value !== 'string') throw apiError_('VALIDATION_ERROR', field + ' debe ser texto.');
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (clean.length > max || (required && !clean)) throw apiError_('VALIDATION_ERROR', field + ' es obligatorio o excede ' + max + ' caracteres.');
  return clean;
}
function id_(value) { const id = text_(value, 'id', 200, true); if (!/^[a-zA-Z0-9_.:\-]+$/.test(id)) throw apiError_('VALIDATION_ERROR', 'ID inválido.'); return id; }
function email_(value) {
  const clean = text_(value, 'correo', 180, true).toLocaleLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw apiError_('VALIDATION_ERROR', 'correo debe ser una dirección válida.');
  return clean;
}
function password_(value) {
  if (typeof value !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{9,200}$/.test(value)) throw apiError_('VALIDATION_ERROR', 'La contraseña debe superar 8 caracteres alfanuméricos e incluir un carácter especial.');
  return value;
}
function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(digest);
}
function enum_(value, options, field) { if (options.indexOf(value) < 0) throw apiError_('VALIDATION_ERROR', 'Valor inválido para ' + field + '.'); return value; }
function number_(value, field, min, max) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw apiError_('VALIDATION_ERROR', field + ' debe ser un número entre ' + min + ' y ' + max + '.'); return value; }
function integer_(value, field, min, max) { number_(value, field, min, max); if (!Number.isInteger(value)) throw apiError_('VALIDATION_ERROR', field + ' debe ser entero.'); return value; }
function bool_(value, field) { if (typeof value !== 'boolean') throw apiError_('VALIDATION_ERROR', field + ' debe ser booleano.'); return value; }
function date_(value, field) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2200-12-31' || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw apiError_('VALIDATION_ERROR', field + ' debe ser una fecha real YYYY-MM-DD.'); return value; }
function iso_(value, field) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw apiError_('VALIDATION_ERROR', field + ' debe ser una fecha ISO UTC.'); date_(value.slice(0, 10), field); return new Date(value).toISOString(); }
function tags_(value) { return Array.from(new Set(text_(value, 'tags', 500, false).toLocaleLowerCase().split(',').map(function (tag) { return tag.replace(/#/g, '').trim(); }).filter(Boolean))).slice(0, 20).join(','); }
function sameToken_(a, b) { let diff = a.length ^ b.length; for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i); return diff === 0; }
function uuid_() { return Utilities.getUuid(); }
function nowIso_(minimum) {
  // El cursor siempre queda después de toda escritura previa, incluso dentro
  // del mismo milisegundo; se invoca únicamente mientras tenemos script lock.
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('DRIP_LAST_CLOCK') || 0);
  const current = Math.max(Date.now(), last + 1, minimum ? Date.parse(minimum) : 0);
  props.setProperty('DRIP_LAST_CLOCK', String(current));
  return new Date(current).toISOString();
}
function apiError_(code, message) { const error = new Error(message); error.apiCode = code; return error; }
function ok_(data) { return json_({ ok: true, data: data }); }
function fail_(code, message) { return json_({ ok: false, error: code, message: message }); }
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
