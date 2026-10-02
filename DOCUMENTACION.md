# Documentación Técnica - Drip

## 📋 Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura](#arquitectura)
3. [Base de Datos](#base-de-datos)
4. [Autenticación](#autenticación)
5. [Registros Financieros](#registros-financieros)
6. [Entidades del Sistema](#entidades-del-sistema)
7. [Teams y Deseos](#teams-y-deseos)
8. [API del Backend](#api-del-backend)
9. [Estructura del Frontend](#estructura-del-frontend)

---

## 🎯 Visión General

Drip es una PWA (Progressive Web App) para gestión financiera personal y en pareja. Permite registrar movimientos, analizar patrones de gasto, y planificar ahorros colaborativos mediante Teams y Deseos.

**URL de Producción:** https://drip-inky.vercel.app/

**Tecnologías:**
- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: Google Apps Script (Google Sheets como base de datos)
- Hosting: Vercel

---

## 🏗️ Arquitectura

### Frontend
- **Framework:** React 18 con TypeScript
- **Gestión de Estado:** TanStack Query para caché y sincronización
- **Almacenamiento Local:** IndexedDB (idb-keyval) para datos offline
- **Routing:** React Router con HashRouter
- **UI:** Tailwind CSS + Framer Motion

### Backend
- **Plataforma:** Google Apps Script
- **Base de Datos:** Google Sheets
- **API:** RESTful sobre Content Service
- **Autenticación:** SHA-256 con salt por usuario

---

## 🗄️ Base de Datos

### Estructura de Google Sheets

El backend utiliza un Google Sheet con las siguientes pestañas:

| Pestaña | Propósito |
|---------|-----------|
| `Registros` | Movimientos financieros individuales |
| `Categorias` | Categorías de ingresos y gastos |
| `Deudas` | Registro de deudas y sus términos |
| `Recurrentes` | Plantillas de pagos recurrentes |
| `Config` | Configuración global de la aplicación |
| `Usuarios` | Cuentas de usuario autenticadas |
| `Teams` | Grupos colaborativos para deseos |
| `Deseos` | Objetivos de ahorro por team |
| `Votos` | Sistema de votación en deseos |
| `Comentarios` | Comentarios en deseos |
| `TeamWallets` | Carteras compartidas de teams |

---

## 🔐 Autenticación

### Modelo de Usuario

```typescript
interface Usuario {
  id: string;           // UUID único
  nombre: string;       // Nombre completo
  correo: string;       // Correo electrónico (normalizado a minúsculas)
  password_hash: string; // SHA-256 de contraseña + salt
  salt: string;         // Salt aleatoria por usuario
  creado_en: string;    // ISO timestamp UTC
}
```

### Flujo de Autenticación

1. **Registro:**
   - El usuario ingresa nombre, correo y contraseña
   - Validación en frontend: +8 caracteres alfanuméricos + 1 carácter especial
   - Backend genera salt y hash: `SHA-256(password + salt)`
   - Verifica que el correo no exista previamente
   - Retorna solo: `id`, `nombre`, `correo` (nunca hash ni salt)

2. **Login:**
   - Usuario ingresa correo y contraseña
   - Backend busca usuario por correo
   - Verifica hash: `SHA-256(password + salt) === stored_hash`
   - Mensaje genérico en caso de error (no confirma si correo existe)
   - Retorna: `id`, `nombre`, `correo`

3. **Sesión:**
   - Se guarda en `localStorage` del dispositivo
   - Clave: `drip:auth:v1`
   - Formato: JSON con `id`, `nombre`, `correo`
   - No hay token de dispositivo; identificación solo por correo/contraseña

### Seguridad

- **Contraseñas:** Nunca se almacenan en texto plano
- **Hash:** SHA-256 con salt aleatoria por usuario
- **Exposición:** El backend nunca devuelve `password_hash` ni `salt`
- **Privacidad:** Los registros están ligados a `usuario_id` para filtrado por usuario

---

## 💰 Registros Financieros

### Modelo de Registro

```typescript
interface Registro {
  id: string;              // UUID único
  fecha: string;           // YYYY-MM-DD
  tipo: Tipo;              // 'ingreso' | 'gasto' | 'deuda_aumento' | 'deuda_pago' | 'sin_gasto'
  subtipo: string;         // 'sueldo' | 'adicional' | 'variable' | 'fijo' | ''
  monto: number;           // Monto positivo
  categoria: string;       // Nombre de categoría existente
  tags: string;            // Comas, minúsculas, sin #
  descripcion: string;     // Descripción del movimiento
  metodo_pago: Metodo;    // 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'otro'
  necesidad: string;       // 'necesario' | 'innecesario' | '' (solo gastos)
  recurrente_id: string;   // ID de plantilla recurrente (opcional)
  deuda_id: string;        // ID de deuda (solo pagos/aumentos de deuda)
  creado_en: string;       // ISO timestamp UTC
  actualizado_en: string;  // ISO timestamp UTC
  eliminado: boolean;     // Borrado lógico
  usuario_id?: string;     // ID del usuario que creó el registro
}
```

### Tipos de Transacciones

| Tipo | Subtipos válidos | Descripción |
|------|------------------|-------------|
| `ingreso` | `sueldo`, `adicional` | Entradas de dinero |
| `gasto` | `variable`, `fijo` | Salidas de dinero |
| `deuda_aumento` | `` | Aumento de deuda (no crea ingreso) |
| `deuda_pago` | `` | Pago a deuda (se cuenta como gasto) |
| `sin_gasto` | `` | Confirmación de día sin compras (monto = 0) |

### Métodos de Pago

- `efectivo` - Dinero en mano
- `debito` - Tarjeta débito
- `credito` - Tarjeta crédito
- `transferencia` - Transferencia bancaria
- `otro` - Otro método

### Flujo de Datos

1. **Captura Offline:**
   - Registro se guarda inmediatamente en IndexedDB
   - Se añade a cola de operaciones pendientes
   - Estado persiste después de recargar

2. **Sincronización:**
   - Se envían operaciones en lotes (máx 250)
   - Cada operación tiene UUID para idempotencia
   - Conflicos se resuelven por `actualizado_en` (última escritura gana)
   - Reintentos automáticos con mismo UUID

3. **Filtrado por Usuario:**
   - Frontend filtra registros donde `usuario_id === user.id`
   - Registros sin `usuario_id` no se muestran (seguridad)
   - En modo demo, no se aplica filtrado

---

## 📦 Entidades del Sistema

### Categorías

```typescript
interface Categoria {
  id: string;                  // 'cat-' + nombre
  nombre: string;               // Nombre único
  tipo: 'ingreso' | 'gasto';   // Tipo de transacción
  color: string;                // Hexadecimal #RRGGBB
  icono: string;                // Nombre de icono Lucide
  presupuesto_mensual: number;  // Presupuesto mensual
  activa: boolean;              // Estado activo/inactivo
}
```

**Categorías Iniciales:**
- Ingresos: Sueldo, Ingreso extra
- Gastos: Vivienda, Servicios, Mercado, Comida fuera, Transporte, Salud, Educación, Ocio, Suscripciones, Ropa, Deudas, Ahorro, Otros

### Deudas

```typescript
interface Deuda {
  id: string;                      // UUID único
  nombre: string;                   // Nombre de la deuda
  acreedor: string;                 // Nombre del acreedor
  monto_inicial: number;           // Monto inicial prestado
  tasa_interes_mensual: number;    // Porcentaje mensual (2 = 2%)
  fecha_inicio: string;            // YYYY-MM-DD
  cuota_minima: number;            // Pago mínimo mensual
  dia_pago: number;                // Día del mes (1-31)
  activa: boolean;                 // Estado activo/inactivo
}
```

### Recurrentes (Plantillas)

```typescript
interface Recurrente {
  id: string;                      // UUID único
  descripcion: string;             // Descripción del pago
  monto: number;                   // Monto del pago
  categoria: string;               // Categorización
  tags: string;                    // Tags asociados
  frecuencia: 'semanal' | 'quincenal' | 'mensual' | 'anual';
  dia: number;                      // Día del mes (1-31)
  proximo_pago: string;            // YYYY-MM-DD próximo pago
  metodo_pago: Metodo;             // Método de pago
  activa: boolean;                 // Estado activo/inactivo
}
```

**Materialización:**
- La acción `materializeRecurrentes` genera pagos vencidos
- Clave única: `recurrente_id + fecha` evita duplicados
- Máximo 500 pagos por llamada para respetar límites de Apps Script

### Configuración

```typescript
interface Config {
  moneda: string;                    // Código ISO (ej: COP)
  umbral_hormiga: number;            // Monto máximo para "gasto hormiga"
  min_repeticiones_hormiga: number;   // Mínimo de repeticiones para considerar
  tipo_ciclo: 'auto' | 'mensual' | 'quincenal';
  dia_corte: number;                  // Día de corte del ciclo (1-31)
  excluir_fijos_de_racha: boolean;    // ¿Fijos rompen racha?
  meta_reduccion_semanal_pct: number; // Meta de reducción semanal (%)
}
```

---

## 🌟 Teams y Deseos

### Teams (Grupos Colaborativos)

```typescript
interface Team {
  id: string;                  // UUID único
  nombre: string;               // Nombre del team
  creador_id: string;          // ID del usuario creador
  miembros: string;            // JSON array de usuario_id: ["id1", "id2"]
  creado_en: string;           // ISO timestamp UTC
  actualizado_en: string;      // ISO timestamp UTC
  activo: boolean;             // Estado activo/inactivo
}
```

**Funcionalidades:**
- **Crear Team:** Solo usuarios autenticados
- **Invitar Miembros:** Solo creador, invita por correo (debe estar registrado)
- **Validación:** El correo debe existir en tabla `Usuarios`
- **Wallet:** Cada team tiene una wallet automática al crearse

### Deseos (Objetivos de Ahorro)

```typescript
interface Deseo {
  id: string;                  // UUID único
  team_id: string;             // ID del team al que pertenece
  titulo: string;              // Título del deseo
  descripcion: string;         // Descripción detallada
  monto_objetivo: number;     // Monto total a ahorrar
  monto_actual: number;       // Monto acumulado actualmente
  creador_id: string;          // ID del usuario que creó el deseo
  creado_en: string;           // ISO timestamp UTC
  actualizado_en: string;      // ISO timestamp UTC
  eliminado: boolean;          // Borrado lógico
  aprobado: boolean;           // Estado de aprobación (100% likes)
  votos: Voto[];              // Array de votos (no se guarda en Sheet, se calcula)
  comentarios: Comentario[];   // Array de comentarios (no se guarda en Sheet, se calcula)
}
```

**Estado de Aprobación:**
- `aprobado = false` inicialmente
- Se aprueba cuando 100% de miembros del team dan `like`
- Una vez aprobado, la wallet se abre para registrar ingresos/retiros

### Votos

```typescript
interface Voto {
  id: string;          // UUID único
  deseo_id: string;     // ID del deseo votado
  usuario_id: string;  // ID del usuario que vota
  tipo: 'like' | 'dislike' | 'revision';
  creado_en: string;   // ISO timestamp UTC
}
```

**Tipos de Voto:**
- `like` - Aprobación del deseo
- `dislike` - Rechazo del deseo
- `revision` - Solicita revisión o cambios

**Reglas:**
- Cada usuario puede votar una vez por deseo
- Puede cambiar su voto (actualiza registro existente)
- 100% likes = deseo aprobado automáticamente

### Comentarios

```typescript
interface Comentario {
  id: string;          // UUID único
  deseo_id: string;     // ID del deseo comentado
  usuario_id: string;  // ID del usuario que comenta
  texto: string;        // Texto del comentario (máx 1000 caracteres)
  creado_en: string;   // ISO timestamp UTC
}
```

### Team Wallets (Carteras Compartidas)

```typescript
interface TeamWallet {
  team_id: string;      // ID del team
  saldo: number;        // Saldo actual de la wallet
  creado_en: string;    // ISO timestamp UTC
  actualizado_en: string; // ISO timestamp UTC
}
```

**Operaciones:**
- **Agregar a Wallet:** Cualquier miembro del team puede agregar dinero
- **Retirar de Wallet:** Solo el creador del team puede retirar
- Los retiros se registran como gastos en la wallet del team
- Los ingresos se registran como gastos de la cuenta normal del usuario

---

## 🔌 API del Backend

### Contrato HTTP

**Método:** POST  
**Content-Type:** text/plain;charset=utf-8  
**Cuerpo:** JSON

```json
{
  "action": "nombre_accion",
  ...parametros_especificos
}
```

**Respuesta Exitosa:**
```json
{
  "ok": true,
  "data": { ...datos_especificos }
}
```

**Respuesta de Error:**
```json
{
  "ok": false,
  "error": "CODIGO_ERROR",
  "message": "Mensaje descriptivo"
}
```

### Acciones Disponibles

| Acción | Parámetros | Descripción |
|--------|------------|-------------|
| `list` | `since` (opcional) | Obtiene todos los datos modificados desde cursor |
| `upsert` | `registro` | Crea o actualiza un registro |
| `delete` | `id`, `actualizado_en` | Borrado lógico de registro |
| `batch` | `operations[]` | Ejecuta múltiples operaciones atómicas |
| `saveEntity` | `entity`, `data` | Guarda categoría, deuda o recurrente |
| `saveConfig` | `config` | Actualiza configuración global |
| `materializeRecurrentes` | - | Genera pagos recurrentes vencidos |
| `register` | `nombre`, `correo`, `password` | Registra nuevo usuario |
| `login` | `correo`, `password` | Autentica usuario existente |
| `createTeam` | `nombre`, `usuario_id` | Crea nuevo team |
| `inviteToTeam` | `team_id`, `correo`, `usuario_id` | Invita usuario por correo |
| `createWish` | `team_id`, `titulo`, `descripcion`, `monto_objetivo`, `usuario_id` | Crea nuevo deseo |
| `voteWish` | `deseo_id`, `tipo`, `usuario_id` | Vota en un deseo |
| `addComment` | `deseo_id`, `texto`, `usuario_id` | Agrega comentario a deseo |
| `addToWallet` | `team_id`, `monto`, `usuario_id` | Agrega dinero a wallet |
| `withdrawFromWallet` | `team_id`, `monto`, `usuario_id` | Retira dinero de wallet |

### Códigos de Error

| Código | Descripción |
|--------|-------------|
| `BAD_REQUEST` | Cuerpo JSON inválido o faltante |
| `BAD_JSON` | JSON inválido |
| `PAYLOAD_TOO_LARGE` | Petición excede 1 MB |
| `UNKNOWN_ACTION` | Acción no reconocida |
| `SCHEMA_MISMATCH` | Encabezados de Sheet incorrectos |
| `VALIDATION_ERROR` | Datos inválidos |
| `DUPLICATE_USER` | Correo ya registrado |
| `UNAUTHORIZED` | Credenciales incorrectas |
| `USER_NOT_FOUND` | Usuario no encontrado (para invitación) |
| `ALREADY_MEMBER` | Usuario ya es miembro del team |
| `NOT_FOUND` | Recurso no encontrado |
| `INSUFFICIENT_FUNDS` | Saldo insuficiente en wallet |
| `SERVER_NOT_CONFIGURED` | SPREADSHEET_ID no configurado |
| `CLOCK_SKEW` | Reloj del dispositivo adelantado |
| `SERVER_ERROR` | Error interno del servidor |

---

## 🎨 Estructura del Frontend

### Componentes Principales

| Página | Ruta | Descripción |
|--------|------|-------------|
| `Home` | `/` | Dashboard principal con ciclo actual, racha, alertas |
| `Movimientos` | `/movimientos` | Lista de movimientos con filtros y búsqueda |
| `Analisis` | `/analisis` | Gráficos, patrones, métricas financieras |
| `Wishes` | `/wishes` | Teams, deseos, votación y carteras compartidas |
| `Más` | `/mas` | Deudas, recurrentes, categorías, ajustes |
| `Agregar` | Modal | Formulario de captura rápida |

### Hooks Personalizados

- `useData()` - Gestión de datos, caché y sincronización
- `useAuth()` - Autenticación y sesión de usuario
- `useSettings()` - Configuración de conexión y modo demo

### Almacenamiento Local

**IndexedDB:**
- Clave: `drip:cache:v1:{namespace}`
- Contiene: registros, cola de operaciones pendientes, cursor de sincronización
- Namespace: Hash SHA-256 de la URL de Apps Script

**LocalStorage:**
- `drip:auth:v1` - Sesión de usuario autenticado
- `drip:unconfigured-stores:v1` - Índice de namespaces sin conexión

---

## 🔄 Sincronización Offline

### Flujo Offline

1. **Captura:**
   - Registro se guarda en IndexedDB inmediatamente
   - Se añade operación a cola pendiente
   - UI refleja cambio instantáneamente

2. **Cola de Operaciones:**
   ```typescript
   interface QueuedOperation {
     queueId: string;        // UUID de la operación en cola
     operation: Operation;   // { action: 'upsert', registro } | { action: 'delete', id, actualizado_en }
   }
   ```

3. **Sincronización Automática:**
   - Al abrir la app
   - Al recuperar conexión
   - Al volver al primer plano
   - Cada 60 segundos
   - Manual: botón "Sincronizar ahora"

4. **Resolución de Conflictos:**
   - Cada operación tiene UUID idempotente
   - Conflicos se resuelven por `actualizado_en` (más reciente gana)
   - Reintentos con mismo UUID son no-ops si ya se aplicaron

---

## 📊 Análisis y Métricas

### Cálculos Implementados

**Totales:**
- Ingresos = suma de `tipo='ingreso'`
- Gastos = suma de `tipo='gasto'` + `tipo='deuda_pago'`
- Ahorro = Ingresos - Gastos
- Disponible = Ahorro neto - aportes a ahorro + retiros de ahorro. Los pagos a deuda ya están incluidos una sola vez dentro de Gastos.

**Ciclos:**
- Automáticos: Delimitados por fechas de sueldo
- Manuales: Basados en `dia_corte` configurado
- Proyección: Gasto acumulado ÷ días transcurridos × días del ciclo

**Hormiga:**
- Últimos 30 días inclusivos
- Solo gastos variables bajo umbral
- Repetición por descripción normalizada O categoría
- Proyección anual = total × 12

**Racha:**
- Días desde último gasto que rompe racha
- Días no confirmados desde primer registro
- Fijos y pagos de deuda no rompen racha (configurable)

**Deuda:**
- Saldo = inicial + aumentos + interés − pagos
- Interés aplicado mensualmente sobre saldo cronológico
- Liberación estimada con cuota mínima constante

---

## 🔐 Seguridad

### Principios de Seguridad

1. **Autenticación:**
   - Sin token de dispositivo
   - Identificación solo por correo/contraseña
   - Hash SHA-256 con salt por usuario

2. **Autorización:**
   - Frontend filtra por `usuario_id`
   - Backend valida contexto (ej: solo creador puede retirar de wallet)
   - Invitaciones solo a usuarios registrados

3. **Privacidad:**
   - Registros sin `usuario_id` no se muestran
   - `password_hash` y `salt` nunca salen del backend
   - Mensajes de error genéricos (no confirman existencia de usuarios)

4. **Validación:**
   - Validación en frontend y backend
   - Sanitización de fórmulas en Sheets
   - Límites de tamaño y tipos de datos

---

## 🚀 Despliegue

### Backend (Google Apps Script)

1. Crear Google Sheet vacío
2. Copiar ID de la URL
3. Abrir Extensions → Apps Script
4. Pegar contenido de `backend/Code.gs`
5. Configurar constantes:
   ```javascript
   const SPREADSHEET_ID = 'ID_DE_TU_HOJA';
   const SHEET_NAME = 'Registros';
   const TIMEZONE = 'America/Bogota';
   ```
6. Ejecutar `setup()` para crear tablas
7. Implementar → Nueva implementación → Aplicación web
8. Configurar: Ejecutar como: Yo, Quién tiene acceso: Cualquier usuario
9. Copiar URL terminada en `/exec`

### Frontend (Vercel)

1. Configurar variable de entorno:
   ```
   VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec
   ```
2. Ejecutar:
   ```bash
   npm run build
   ```
3. Desplegar en Vercel
4. La app usa HashRouter, no requiere configuración de rutas

---

## 📝 Notas Importantes

### Cambios validados — 2026-10-02

- Se conservó `logo.png` en la raíz y se usa como identidad visual: el encabezado muestra el icono ampliado, el favicon y los iconos PWA se generan desde `public/logo.png`.
- Se añadió una capa visual de cristal líquido con degradados, bordes y sombras suaves en tarjetas, equipos, deseos, carteras y formularios. Incluye fallback sin `backdrop-filter` y mantiene objetivos táctiles para móvil.
- Se añadió la tarjeta de ahorro. Los aportes se guardan como gasto con el tag reservado `ahorro_deposito`; los retiros como ingreso con `ahorro_retiro`, por lo que no se requiere migrar las columnas de Sheets. La racha cuenta días calendario completos desde el aporte, acumula mientras el saldo sea positivo y se reinicia con cualquier retiro; un depósito adicional no la reinicia. El saldo no se puede retirar por debajo de cero y las ediciones retroactivas se validan cronológicamente.
- Los pagos `deuda_pago` se contabilizan una sola vez como gasto. Ya no se vuelven a restar del disponible, y se incluyen en categorías, PDF y resumen compartido.
- Deseos ahora interpreta la respuesta de `client.request` correctamente (la función ya devuelve `data` desempaquetado), normaliza `miembros` tanto si llega como JSON desde Sheets como si llega como arreglo, conserva equipos/deseos en IndexedDB durante la sincronización y actualiza la caché después de crear un equipo.
- Se validó el proyecto con `npm test` (103 pruebas) y `npm run build:vercel` (TypeScript estricto + Vite + comprobación de variable de Apps Script). No se modificaron registros reales ni se eliminaron archivos de datos.
- Se añadió `BubbleBackground`, una capa CSS de burbujas gaseosas que nace en el pie, flota con gradiente y desaparece cerca de la mitad de la pantalla. Es decorativa, no captura eventos y respeta `prefers-reduced-motion`.
- El espacio autenticado ocupa ahora todo el ancho disponible en escritorio y móvil; la barra lateral conserva su navegación sin dejar márgenes artificiales del antiguo límite de 1.440 px.
- Se incorporó un footer global con derechos de autor `© Camilo Molina` y enlace a `https://github.com/CamiloTechCore`: queda fijo en la vista de PC y forma parte del flujo normal al final de cada sección en móvil.
- La animación de burbujas se extendió a toda la altura del viewport: ahora ascienden de forma continua desde el footer hasta el header, con desfases negativos para mantener movimiento visible desde la primera carga y opacidad gradual para no competir con la interfaz.
- Se corrigió la navegación móvil: una regla de apilamiento del fondo estaba convirtiendo accidentalmente la barra fija en contenido normal. Ahora permanece fija, respeta las safe areas y conserva espacio inferior para que no tape los controles.
- El footer de autoría móvil se fijó explícitamente al flujo del documento, con espacio inferior para la navegación fija. Ahora aparece al llegar al final de todas las secciones, incluidas las pantallas cortas.
- Se corrigió el alineamiento de escritorio a pantalla completa: la barra lateral y el logo ya parten desde el borde izquierdo real del navegador y no se superponen sobre títulos, tarjetas ni el footer.
- Se mejoró la validación de registros para asignar automáticamente una categoría por defecto ("Otros") cuando la categoría especificada no existe en la caché local. Esto permite que la sincronización de registros pendientes proceda incluso cuando uno de ellos tiene una categoría obsoleta o eliminada, resolviendo el error "La categoría no existe" y permitiendo que los 11 pendientes se procesen correctamente. La misma lógica se aplicó a las plantillas recurrentes para asignar una categoría de gasto por defecto cuando la especificada no existe.
- La sincronización ahora lee primero los registros y categorías canónicos de la base de datos. Cuando hay pendientes, la lectura es completa (sin cursor incremental) para recuperar confirmaciones perdidas: concilia por ID y versión/contenido, retira únicamente operaciones ya confirmadas y conserva ediciones más recientes, incluidas las creadas durante la lectura. Los registros confirmados recuperan los valores y fechas del servidor sin reenviarse. Para categorías locales inválidas se prioriza el renombrado por ID o la categoría válida del registro remoto; los movimientos aún no guardados usan `Otros` o una categoría válida del mismo tipo como respaldo.
- `public/logo.png` es ahora el botón central de `Agregar` en la navegación móvil y de escritorio. Dos accesos antes y tres después ocupan grupos laterales del mismo tamaño; el centro permanece fijo aunque los grupos tengan distinta cantidad de elementos. Se conservan las rutas, el formulario y la navegación por teclado.
- Validación de esta corrección: `npm test` pasó con 109 pruebas y `npm run build` completó TypeScript, Vite y la generación PWA. Las nuevas pruebas cubren 11 pendientes ya guardados con cursor avanzado y categoría corregida, una edición realmente pendiente, cambios durante la lectura con desfase de reloj, categorías renombradas/inexistentes y borrados confirmados. Se verificó visualmente la navegación a 320, 390, 768 y 1440 px, incluido escritorio de 540 px de alto: logo centrado, enlaces visibles y apertura de `Agregar`. La conciliación usa respuestas simuladas; la limpieza en el dispositivo real requiere cargar esta versión y sincronizar.

### Limitaciones de Apps Script

- Máximo 30 segundos de ejecución por request
- Máximo 500 operaciones por batch
- Limitación de filas por hoja
- No se permiten disparadores periódicos

### Compatibilidad

- Móviles: 320px - 1920px (responsive)
- Tablets: 768px+ (adaptaciones específicas)
- Desktop: 431px+ (marco centrado)
- Navegadores: Chrome, Safari, Firefox, Edge (moderno)

### PWA

- Manifest incluido para instalación
- Service worker para caché offline
- Íconos en múltiples tamaños
- Safe areas para dispositivos móviles

---

## 📚 Versiones

| Versión | Fecha | Cambios Principales |
|---------|-------|---------------------|
| V:0.0.0.01 | - | Versión inicial |
| V:0.0.0.02 | - | Mejoras en validación |
| V:0.0.0.03 | - | Autenticación por correo/contraseña, usuario_id |
| V:0.0.0.04 | - | Corrección en sembrado de categorías |
| V:0.0.0.05 | - | Versión estable actual (sin Teams) |
| V:0.0.0.06 | 2026-10-01 | Teams, Deseos, Votos, Comentarios, Wallets |

---

## 🔗 Recursos

- **Código Frontend:** `src/`
- **Código Backend:** `backend/Code.gs`
- **Documentación Usuario:** `README.md`
- **Tests:** `tests/`
- **URL Producción:** https://drip-inky.vercel.app/
