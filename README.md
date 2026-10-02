# 💧 Drip

**Daily Records for Individuals & Partners**: registros diarios para tus finanzas personales y en pareja.

Drip es una PWA en español, de tema claro, adaptable a teléfonos, tablets y escritorio. Registra movimientos en Google Sheets mediante un único archivo de Google Apps Script, permite capturar gastos sin conexión y convierte el historial en ciclos, alertas y hábitos de ahorro.

## 🌟 Visión y Propósito

Drip nace con la misión de transformar la relación de las parejas con el dinero. Creemos firmemente que **compartir buenos hábitos financieros es fundamental**, incluso cuando no se vive bajo el mismo techo. La transparencia en los gastos, la comunicación abierta sobre metas financieras y el trabajo conjunto hacia objetivos comunes son pilares que fortalecen cualquier relación.

### ¿Por qué es importante compartir hábitos financieros en pareja?

- **Construcción de confianza**: La transparencia financiera crea un ambiente de confianza mutua y honestidad
- **Alineación de metas**: Permite establecer objetivos financieros compartidos y trabajar en equipo para alcanzarlos
- **Reducción de conflictos**: Evita malentendidos y tensiones relacionadas con el dinero
- **Educación mutua**: Cada pareja puede aprender de los hábitos positivos del otro
- **Preparación para el futuro**: Facilita la planificación de proyectos importantes como vivienda, viajes o inversión
- **Responsabilidad compartida**: Promueve un sentido de responsabilidad conjunta sobre las decisiones financieras

### Proyectos de ahorro futuros

Drip está diseñado para evolucionar junto con tus necesidades financieras. Entre nuestros planes futuros incluyen:

- **Wishes (Deseos)**: Sistema de equipos compartidos para planificar y ahorrar juntos para metas específicas
- **Metas colaborativas**: Herramientas para establecer y seguimiento de objetivos financieros en pareja
- **Alertas inteligentes**: Notificaciones personalizadas basadas en patrones de gasto
- **Comparativas anónimas**: Benchmarking de hábitos financieros con parejas similares
- **Integración con bancos**: Conexión segura para importar transacciones automáticamente
- **Educación financiera**: Contenido personalizado sobre gestión de dinero en pareja

## 🚀 Tecnologías del Proyecto

### Frontend
- **React 18** - Framework UI moderno y eficiente
- **TypeScript** - Tipado estático para mayor seguridad en el código
- **Vite** - Build tool ultra rápido
- **Tailwind CSS** - Framework CSS utilitario para diseño responsive
- **Framer Motion** - Animaciones fluidas y profesionales
- **TanStack Query** - Gestión de estado y caché de datos
- **Recharts** - Gráficos interactivos para análisis financiero
- **date-fns** - Manipulación de fechas ligera y moderna
- **jsPDF** - Generación de reportes PDF
- **Lucide React** - Iconos modernos y consistentes
- **React Router** - Navegación client-side con HashRouter

### Backend
- **Google Apps Script** - Plataforma serverless integrada con Google Sheets
- **Google Sheets** - Base de datos en la nube colaborativa
- **Content Service** - API RESTful sin infraestructura adicional

### Infraestructura
- **Vercel** - Hosting y despliegue continuo
- **GitHub Actions** - CI/CD automatizado
- **PWA** - Aplicación web progresiva con soporte offline

## 🌐 URL del Proyecto

**https://drip-inky.vercel.app/**

Disponible 24/7, optimizado para funcionar en cualquier dispositivo moderno con conexión a internet.

Se usa un **libro compartido privado**: quienes conocen la URL acceden al mismo conjunto de datos. Desde `Drip_API:V:0.0.0.03` cada persona inicia sesión con su propio correo y contraseña; ya no existe un token de dispositivo, y la cuenta identifica quien creó cada movimiento mediante `usuario_id`. Puedes usar tags como `personal`, `en pareja` o `hogar`; no representan identidades verificadas, pero ahora se complementan con la cuenta de quien registra. No hay integración bancaria ni publicación en App Store; la aplicación se mantiene exclusivamente como sitio web.

## 1. Backend: un único `Code.gs`

El backend completo está en [`backend/Code.gs`](backend/Code.gs). No requiere archivos `.gs` adicionales, vistas HTML, servidores propios ni instalaciones de npm.

### Conectar una hoja

1. Crea un Google Sheet vacío y copia el ID de su URL: `https://docs.google.com/spreadsheets/d/ID_DE_LA_HOJA/edit`.
2. Abre **Extensiones → Apps Script**. Sustituye el contenido de `Code.gs` por [`backend/Code.gs`](backend/Code.gs).
3. Modifica las tres constantes al inicio **en el editor de Apps Script**:

   ```javascript
   const SPREADSHEET_ID = 'PEGA_AQUI_EL_ID_DE_TU_HOJA';
   const SHEET_NAME = 'Registros';
   const TIMEZONE = 'America/Bogota';
   ```

4. Ejecuta `setup()` desde el editor y autoriza sus permisos. Se crean las pestañas, encabezados, formatos, listas desplegables, categorías iniciales y la hoja `Usuarios`.
5. Selecciona **Implementar → Nueva implementación → Aplicación web**. Configura **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier usuario**.
6. Copia la URL terminada en `/exec`. Puedes abrirla para comprobar `{"ok":true,"service":"finanzas","version":"Drip_API:V:0.0.0.03"}`. La prueba de vida no revela datos.
7. En Drip, la primera pantalla pide el correo y la contraseña para ingresar o registrarte; la URL de Apps Script ya viene configurada desde `VITE_APPS_SCRIPT_URL`.

Cada modificación del backend requiere editar la implementación y seleccionar **Nueva versión**. Reutilizar la implementación mantiene su URL. La URL `/dev` del editor no sirve como conexión de producción.

`setup()` es repetible y no borra movimientos ni usuarios. El backend comprueba los encabezados y devuelve `SCHEMA_MISMATCH` si su orden fue modificado; conserva los nombres y el orden de las columnas. Una hoja `Registros` creada con `Drip_API:V:0.0.0.01` se actualiza automáticamente agregando la columna `usuario_id` al ejecutar `setup()` o la primera petición; no es necesario recrear la pestaña. El acceso ya no depende de un token compartido: cualquier persona con la URL puede llamar a la API, y la hoja de `Usuarios` es la única barrera de identidad. No compartas públicamente el Sheet ni la URL del despliegue si no quieres que se registren cuentas nuevas.

### Contrato HTTP

Las operaciones usan `POST` con JSON en el cuerpo y `Content-Type: text/plain;charset=utf-8`. El cliente usa `redirect: 'follow'`, `credentials: 'omit'`, tiempo máximo de espera y reintentos de errores de red. Google sirve las respuestas de Content Service mediante una redirección a `script.googleusercontent.com`; por eso el cliente debe seguir redirecciones. [Documentación oficial de Content Service](https://developers.google.com/apps-script/guides/content).

```json
{
  "action": "upsert",
  "registro": {
    "id": "7f725289-284c-4c32-a3e7-0a89b1bf8ac5",
    "fecha": "2026-09-30",
    "tipo": "gasto",
    "subtipo": "variable",
    "monto": 6500,
    "categoria": "Comida fuera",
    "tags": "tinto,antojo",
    "descripcion": "Tinto",
    "metodo_pago": "efectivo",
    "necesidad": "innecesario"
  }
}
```

| Acción | Parámetros | Resultado |
| --- | --- | --- |
| `list` | `since` opcional, ISO datetime | Registros modificados, categorías, deudas, recurrentes, configuración y `serverTime` |
| `upsert` | `registro` | Movimiento canónico guardado; el UUID identifica creación o edición |
| `delete` | `id`, `actualizado_en` | Borrado lógico; conserva la fila |
| `batch` | `operations: [{action:"upsert",registro}, {action:"delete",id,actualizado_en}]` | Movimientos canónicos y `serverTime` |
| `saveEntity` | `entity: "categoria" | "deuda" | "recurrente"`, `data` | Entidad validada |
| `saveConfig` | `config` | Configuración validada |
| `materializeRecurrentes` | Sin parámetros adicionales | Pagos vencidos generados, plantillas actualizadas y `pending` |
| `register` | `nombre`, `correo`, `password` | Cuenta creada en `Usuarios`; retorna `id`, `nombre`, `correo` (nunca el hash ni la sal) |
| `login` | `correo`, `password` | Cuenta autenticada; retorna `id`, `nombre`, `correo` |

El correo y la contraseña identifican a la persona dentro del libro compartido; ya no hay un token de dispositivo separado. La contraseña exige más de 8 caracteres alfanuméricos más un carácter especial, validado tanto en el cliente como en el servidor. Los errores de `login` usan siempre el mismo mensaje genérico para no confirmar si un correo existe.

Las respuestas siguen `{ok:true,data:…}` o `{ok:false,error:"CODIGO",message:"…"}`. `doGet` es la única excepción de forma: responde directamente con `ok` y `service`. No se confía en el código HTTP para distinguir errores de aplicación.

Todas las escrituras están protegidas con `LockService.getScriptLock().waitLock(30000)`. Se comprueban fechas, enums, importes, categorías y relaciones. Las lecturas se realizan en bloque y se agrupan las escrituras; no se escriben celdas individualmente en bucles. Los textos potencialmente interpretables como fórmulas se escapan al escribirlos en Sheets.

### Esquema de Sheets

| Pestaña | Columnas en orden |
| --- | --- |
| `Registros` | `id · fecha · tipo · subtipo · monto · categoria · tags · descripcion · metodo_pago · necesidad · recurrente_id · deuda_id · creado_en · actualizado_en · eliminado · usuario_id` |
| `Categorias` | `id · nombre · tipo · color · icono · presupuesto_mensual · activa` |
| `Deudas` | `id · nombre · acreedor · monto_inicial · tasa_interes_mensual · fecha_inicio · cuota_minima · dia_pago · activa` |
| `Recurrentes` | `id · descripcion · monto · categoria · tags · frecuencia · dia · proximo_pago · metodo_pago · activa` |
| `Config` | `clave · valor` |
| `Usuarios` | `id · nombre · correo · password_hash · salt · creado_en` |

`usuario_id` identifica quién creó cada movimiento; queda vacío en registros antiguos o si el cliente no envía una sesión iniciada. Categorías, deudas, recurrentes y configuración se mantienen compartidas entre todas las personas del libro, igual que antes. La hoja `Usuarios` solo expone `id`, `nombre` y `correo` por API; `password_hash` y `salt` nunca salen del Sheet.

Fechas: `YYYY-MM-DD`; fechas de creación/actualización: ISO con zona UTC. Los importes son positivos; `tipo` determina su interpretación. `sin_gasto` siempre tiene monto cero. Los tipos son `ingreso`, `gasto`, `deuda_aumento`, `deuda_pago` y `sin_gasto`. Los subtipos son `sueldo`/`adicional` para ingresos y `variable`/`fijo` para gastos. Los demás tipos usan subtipo vacío.

Los métodos de pago son `efectivo`, `debito`, `credito`, `transferencia` y `otro`. La necesidad `necesario`/`innecesario` corresponde a gastos. Los tags se separan con comas, en minúscula y sin `#`. La tasa de interés es un **porcentaje mensual**: `2` significa 2 %, no 200 %.

Categorías iniciales: Sueldo, Ingreso extra, Vivienda, Servicios, Mercado, Comida fuera, Transporte, Salud, Educación, Ocio, Suscripciones, Ropa, Deudas, Ahorro y Otros.

| Configuración | Valor inicial |
| --- | --- |
| `moneda` | `COP` |
| `umbral_hormiga` | `20000` |
| `min_repeticiones_hormiga` | `3` |
| `tipo_ciclo` | `auto` |
| `dia_corte` | `1` |
| `excluir_fijos_de_racha` | `true` |
| `meta_reduccion_semanal_pct` | `0` |

## 2. Frontend React

### Ejecutar localmente

Requiere Node.js 20 compatible con las versiones del lockfile y npm.

```bash
npm ci
npm run dev
```

Abre la dirección que muestra Vite. No necesitas configurar Google para explorar la interfaz: **Más → Modo demo** habilita un conjunto ficticio de seis meses. El modo real comienza vacío; los ejemplos se almacenan aparte y nunca se envían a Sheets.

Para configurar por archivo, copia `.env.example` a `.env.local`:

```dotenv
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXXXXX/exec
```

La app se sirve siempre desde la raíz del dominio; no hay variable de subruta. **No crees variables de token**: cualquier variable `VITE_*` termina en el bundle público, y la autenticación ya no usa un token de dispositivo.

```bash
npm test
npm run build
npm run preview
```

El service worker se genera para el build de producción; usa `build` y `preview` al validar instalación y funcionamiento offline. Los íconos PNG ya están incluidos. Para regenerarlos:

```bash
node scripts/generate-icons.mjs
```

### Stack y estructura

React 18, TypeScript estricto, Vite, Tailwind CSS, Recharts, Framer Motion, TanStack Query, idb-keyval, date-fns, jsPDF, jspdf-autotable, vite-plugin-pwa, lucide-react y React Router con `HashRouter`.

```text
backend/Code.gs                  Unico archivo del backend
public/icons/                   PNG 180, 192, 512 y maskable
scripts/generate-icons.mjs       Generador reproducible sin dependencias
src/main.tsx                    React, QueryClient y routing
src/App.tsx                     Estructura, navegación y avisos
src/router.tsx                  Rutas hash compatibles con Pages
src/types.ts                    Modelo compartido del cliente
src/api/client.ts               HTTP, IndexedDB, cola y sincronización
src/api/validation.ts           Validación de registros, entidades y credenciales
src/store/settings.ts           URL y modo demo en el dispositivo
src/store/auth.ts               Identidad de la cuenta iniciada en el dispositivo
src/hooks/useData.ts             Caché, estados y mutaciones
src/lib/analytics.ts            Analítica sin dependencias de React
src/lib/defaults.ts             Configuración y categorías iniciales
src/lib/demo.ts                 Datos ficticios explícitos y aislados
src/lib/pdf.ts                  PDF con tablas y barras
src/lib/share.ts                Compartir, descargar y exportar CSV
src/lib/format.ts               Moneda y fechas
src/components/                Componentes reutilizables
src/pages/                     Inicio, Movimientos, Agregar, Análisis, Más y Login
tests/                         Pruebas automatizadas
.github/workflows/deploy.yml    Pruebas, build y GitHub Pages
```

### Cuentas de usuario

Desde `Drip_API:V:0.0.0.03` Drip admite varias personas en el mismo libro, sin token de dispositivo. Antes de ver tus registros, la app muestra un formulario de **Ingresar o Registrarse** con correo y contraseña (y nombre al registrarte); la URL de Apps Script ya viene de `VITE_APPS_SCRIPT_URL`. El modo demo omite este paso por completo.

La contraseña exige más de 8 caracteres alfanuméricos más un carácter especial; el formulario no permite campos vacíos. El cliente valida lo mismo que el backend antes de enviar la solicitud. La sesión iniciada se guarda únicamente en este dispositivo (`localStorage`) y puedes cerrarla desde **Más → Ajustes → Tu cuenta**; cerrar sesión no borra movimientos ni la conexión guardada.

Cada movimiento nuevo queda asociado al `usuario_id` de quien lo creó. Categorías, deudas, recurrentes y configuración se mantienen compartidas entre todas las cuentas del libro, igual que antes. La pantalla de ingreso muestra una ilustración animada en `<canvas>` (`src/components/NeuralCanvas.tsx`) con nodos que trazan un cerebro, una moneda Bitcoin y una billetera. Sus contornos se definen en `src/components/neural-scene.ts`; el movimiento suave mantiene reconocibles las figuras, ajusta la resolución a pantallas Retina y respeta cambios en `prefers-reduced-motion`. La animación se pausa cuando no está visible y el dibujo se conserva al redimensionar.

El login usa una columna hasta 799 px y dos desde 800 px, con adaptación adicional para teléfonos en horizontal. `src/auth.css` controla esa vista; `src/responsive.css` adapta las pantallas internas: cuadrículas desde 768 px, navegación inferior en móvil/tablet y barra lateral desde 1100 px. Los formularios se centran en pantallas amplias y permiten desplazamiento en pantallas de poca altura. La PWA admite ambas orientaciones.

Validación visual del 1 de octubre de 2026: login a 320, 390, 768, 844 (horizontal), 1440 y 1920 px; Inicio, Movimientos, Análisis, Más y formularios revisados con datos demo. Se corrigieron desbordamientos de tooltips y etiquetas de navegación en 320 px. Se mantienen pendientes las pruebas en hardware real con Safari/iOS y Android. Estos cambios de presentación no migran registros ni modifican el backend, las credenciales o la conexión a Sheets.

### Uso diario

- **Inicio:** ciclo actual, disponible por día, proyección, racha, alertas, comparación de ciclos y acceso al resumen.
- **Movimientos:** búsqueda, filtros combinables, agrupación diaria, edición, borrado lógico, refresco e indicador de cambios pendientes.
- **Agregar:** monto y categoría para captura rápida; opciones de ingreso, deuda, tags, fecha, descripción, método, necesidad y recurrencia. “Hoy no gasté” confirma el día.
- **Análisis:** ingresos/gastos/ahorro, ingresos por origen, categorías y presupuestos, tags, hormiga, repetidos, innecesarios, deuda, ciclos, patrones diarios y pagos próximos.
- **Más:** deudas, recurrentes, categorías, ajustes, CSV, sincronización y explicación del producto.

Los controles respetan áreas seguras del dispositivo, objetivos táctiles amplios y movimiento reducido. Las gráficas tienen descripciones accesibles; la interfaz permanece en tema claro. El diseño es mobile-first: en pantallas de computador el marco de la app se mantiene centrado con un ancho máximo (`@media (min-width: 431px)` en `src/styles.css`), sin rediseñar componentes ni cambiar el estilo existente.

### Datos offline y sincronización

Cada movimiento utiliza un UUID del cliente. La captura y el borrado actualizan de inmediato IndexedDB y dejan una operación pendiente. El estado permanece después de recargar. La sincronización se inicia al abrir la app, recuperar conexión, volver al primer plano o pulsar “Sincronizar ahora”. Si iOS suspende la app, se retoma al abrirla; no se presupone ejecución continua en segundo plano.

El cliente envía las operaciones en lotes acotados y conserva la cola hasta recibir la confirmación. Los reintentos mantienen el mismo UUID. Las ediciones realizadas durante una sincronización siguen pendientes y se aplican sobre la respuesta canónica. Las lecturas incrementales usan el cursor `serverTime` del servidor y también traen los borrados lógicos. Los conflictos utilizan la marca `actualizado_en`; el backend asigna una marca monotónica y devuelve la versión canónica. Un reloj del dispositivo adelantado en más de cinco minutos se rechaza para evitar escrituras fechadas artificialmente en el futuro.

Las categorías, deudas, plantillas y configuración requieren conexión en modo real. La cola offline está destinada a movimientos; el modo demo permite editar todo localmente. Las plantillas se materializan mediante la acción explícita de generar pagos vencidos. No se instala un disparador periódico en Apps Script. La clave `recurrente_id + fecha` evita duplicaciones, incluso si un pago generado se borró lógicamente.

Cada combinación de conexión tiene su caché separada. Cambiar la URL no envía silenciosamente registros del libro anterior al nuevo. Si capturaste registros antes de configurar la conexión, usa la opción de **importar registros locales** disponible en Ajustes. El modo demo nunca se importa. No borres el almacenamiento de Safari mientras haya cambios pendientes; el CSV exporta los movimientos que están en el dispositivo.

El service worker precachea la aplicación y usa `stale-while-revalidate` para recursos estáticos del mismo origen. No cachea peticiones `POST` a Apps Script. Los avisos de actualización permiten recargar cuando corresponde. El registro utiliza la integración de vite-plugin-pwa. [Documentación del registro del service worker](https://vite-pwa-org.netlify.app/guide/register-service-worker).

## 3. Reglas de analítica y pruebas

Toda la lógica está en [`src/lib/analytics.ts`](src/lib/analytics.ts). Las funciones reciben registros, configuración y fechas explícitas para que las pruebas sean reproducibles. Los cálculos de calendario usan fechas UTC sin horas; el “hoy” predeterminado corresponde a `America/Bogota`.

### Decisiones de cálculo

| Tema | Regla implementada |
| --- | --- |
| Totales | Ingresos y gastos se suman por separado. Ahorro = ingresos − gastos. Disponible = ahorro − pagos a deuda. Aumentar deuda no crea ingresos. |
| Ciclos automáticos | Fechas distintas de sueldo delimitan los ciclos históricos. La mediana de intervalos clasifica quincenal (`<23` días) o mensual. Con menos de dos sueldos se usa el calendario. |
| Ciclo abierto | El siguiente sueldo se estima a 15 días o al mismo día del siguiente mes. Si está retrasado, el ciclo abierto se extiende hasta el siguiente corte estimado. No se inventan ingresos. |
| Cortes manuales | El día 1–31 se ajusta al último día de meses cortos. Quincenal usa cada corte mensual y 15 días después. |
| Proyección | Gasto acumulado ÷ días transcurridos × días del ciclo. Disponible diario usa el efectivo disponible y los días que faltan, incluyendo hoy. |
| Hormiga | Últimos 30 días inclusivos; solo gastos variables positivos bajo el umbral. Repetición por descripción normalizada **o** categoría dentro de ese conjunto. Cada compra se cuenta una sola vez. Proyección anual = total × 12. |
| Descripciones | Minúsculas, sin tildes, números ni puntuación, espacios normalizados. |
| Crecimiento | Innecesarios compara ventanas consecutivas de igual cantidad de días. Si el anterior es cero y el actual positivo, muestra sin base; cero contra cero da 0 %. |
| Deuda | Saldo inicial + aumentos + interés − pagos. Intereses aplicados mensualmente sobre el saldo cronológico, en aniversarios de inicio; en el mismo día se aplica interés antes de aumentos y pagos. El saldo no baja de cero. |
| Liberación de deuda | Estimación con cuota mínima constante y un mes completo de interés por pago futuro; sin fecha cuando la cuota no cubre el interés o supera el horizonte de 600 meses. No es una liquidación bancaria. |
| Crecimiento de deuda | Saldo al corte comparado con el cierre del mes anterior. Las deudas inactivas conservan su saldo y su historia. |
| Racha diaria | Días desde el último gasto que rompe la racha; cuenta días no confirmados desde el primer registro observado. Cero registros implica cero días. Por defecto, fijos y pagos de deuda no rompen la racha. |
| Confirmaciones | `sin_gasto` refuerza la marca del calendario, sin regalar días adicionales. Un gasto que rompe la racha prevalece sobre una confirmación del mismo día. |
| Racha semanal | Solo semanas completas observadas de lunes a domingo. Debe haber una baja estricta y alcanzar el porcentaje configurado. Ni la primera semana parcial ni la semana actual se comparan. |
| Insignias | Días: 3, 7, 14, 30, 60, 100, alcanzados según la mejor racha. Semanas de reducción: 2, 4, 8, 12. |
| Calendario | Días anteriores al primer registro y futuros se distinguen de los días observados sin gasto. Verde = sin gasto que rompa racha, ámbar = importe pequeño, rojo = importe superior al umbral. |
| Tags | Una compra con varios tags participa en cada uno. No sumes los totales de tags para obtener el gasto global. Duplicados del mismo tag en una compra se cuentan una sola vez. |
| Borrados y futuro | Se excluyen los borrados lógicos. Las funciones con fecha de corte excluyen movimientos posteriores a esa fecha. |

El gasto con método “crédito” sigue siendo un gasto. Si además deseas reflejar su financiación en el saldo de una deuda, registra el aumento asociado a esa deuda; no se crea automáticamente para evitar atribuirlo a un acreedor incorrecto. Al registrar el pago, usa `deuda_pago` para que no vuelva a contarse como consumo.

### Ejecutar pruebas

```bash
npm test
# Solo las pruebas de analítica:
npm test -- tests/analytics.test.ts
```

Las **24 pruebas de analítica** verifican el día de Bogotá al cambiar la fecha UTC, extremos de fechas, años bisiestos, cortes a fin de mes, sueldos duplicados, ciclos forzados, proyecciones, borrados, hormiga por ambas reglas sin doble conteo, periodos comparables, denominador cero, agregaciones, deuda cronológica, pagos superiores al saldo, amortización imposible, rachas y semanas completas, calendario y aislamiento de demo. Estas 24 pruebas se ejecutaron correctamente durante la implementación. La suite general también incluye las verificaciones de los demás módulos que aparecen en `tests/`.

Las **19 pruebas de datos y exportación** en `src/api/client.test.ts` y `src/lib/share.test.ts` se ejecutaron correctamente: cubren escrituras simultáneas persistentes, aislamiento entre conexiones, importación local, reintentos idempotentes, cambios durante sincronización, compactación antes de dividir lotes, borrados, renombrado de categorías, validación offline, recurrentes en demo, CSV seguro y generación del PDF. Se generó además un resumen demo de tres páginas con el mismo código de la aplicación y se inspeccionaron sus tres páginas renderizadas: totales, barras, tablas, saltos de página y detalle legibles, sin solapamientos.

## 4. Compartir PDF y CSV

Selecciona **Compartir resumen** desde Inicio o Análisis y elige ciclo, mes o fechas personalizadas. El PDF se genera en el dispositivo con título, periodo, totales, categorías, barras, gastos hormiga, innecesarios, rachas, deuda y detalle de movimientos.

Después de prepararlo, el botón de compartir solicita la hoja nativa con el archivo PDF cuando el navegador admite compartir archivos. WhatsApp, Mail y otras opciones dependen de las aplicaciones instaladas. También puedes descargar el PDF. Los accesos de WhatsApp por `wa.me` y correo por `mailto:` comparten **solo texto**; estos enlaces no adjuntan archivos.

La exportación CSV incluye todos los movimientos no eliminados del conjunto abierto, escapado de comillas, BOM UTF-8 y neutralización de fórmulas. Los datos del informe no se envían a servicios externos para generarlo.

## 5. Desplegar el frontend

La app se sirve siempre desde la raíz del dominio (`base: "/"` fijo en `vite.config.ts`); no hay variable de subruta. Desplígala en un dominio o subdominio propio (GitHub Pages de usuario/organización, un dominio personalizado, Vercel o Netlify), no como página de proyecto en una subruta.

### Vercel (despliegue actual)

1. En el proyecto existente **drip**, abre **Settings → Environment Variables**.
2. Crea `VITE_APPS_SCRIPT_URL` para **Production** y **Preview**, con exactamente la URL `/exec` ya configurada en el `.env` local. No es la URL del Sheet ni una URL `/dev`; no necesita comillas. El `.env` local está excluido de Git y Vercel no lo recibe automáticamente.
3. Publica los cambios en la rama conectada o usa **Redeploy**. Vite incorpora la variable al compilar: agregarla al panel no corrige una versión ya publicada.
4. `vercel.json` define Vite, `npm ci`, `npm run build:vercel` y la salida `dist`. La compilación valida la conexión antes de publicar y falla con un mensaje útil si falta la variable o se pegó una URL incorrecta.
5. Abre el dominio publicado. Si la PWA muestra “Hay una nueva versión”, pulsa **Actualizar** para cargar la compilación nueva. Usa el correo y contraseña existentes, o cambia a **Regístrate** para crear una cuenta.

No es necesario cambiar de hoja, ejecutar `setup()` de nuevo ni reemplazar usuarios o registros para corregir la configuración de Vercel. Apps Script debe conservar su implementación `/exec`, con **Ejecutar como: Yo** y **Acceso: Cualquier usuario**.

Referencia: [variables de entorno de Vercel y nuevos despliegues](https://vercel.com/docs/environment-variables/managing-environment-variables).

### GitHub Pages (alternativa)

1. Crea un repositorio y sube este proyecto a su rama `main`. Incluye `package-lock.json`.
2. En **Settings → Pages → Source**, selecciona **GitHub Actions**.
3. En **Settings → Secrets and variables → Actions → Variables**, crea `VITE_APPS_SCRIPT_URL` con la URL `/exec` de tu implementación.
4. El workflow ejecuta checkout, Node 20, `npm ci`, pruebas, build, carga del artefacto `dist` y despliegue. También admite ejecución manual.
5. Abre la URL raíz de tu sitio (por ejemplo `https://USUARIO.github.io/` o tu dominio propio).
6. En Safari del iPhone: **Compartir → Añadir a pantalla de inicio**. Abre Drip desde el nuevo ícono e inicia sesión con tu correo y contraseña.

`HashRouter` evita que la navegación interna requiera reescrituras del servidor. El manifest, íconos, `start_url`, `scope` y recursos apuntan a la raíz. El manifest usa `display: standalone`; `index.html` contiene las etiquetas de Apple y `viewport-fit=cover`. Las fuentes están incluidas en los recursos, sin peticiones a Google Fonts.

La URL de Apps Script debe configurarse por separado en cada proveedor utilizado; no copies contraseñas de usuarios ni hashes a las variables de compilación.

## 6. Seguridad y solución de problemas

**Desde `Drip_API:V:0.0.0.05` ya no existe un token de dispositivo.** El Web App de Apps Script sigue publicado con acceso “Cualquier usuario”, por lo que cualquier persona que conozca la URL `/exec` puede llamar a `list`, `upsert`, `batch` y demás acciones sin autenticarse; `register`/`login` identifican a quien escribe cada movimiento (`usuario_id`), pero no restringen quién puede leer o escribir en el libro. Esta es una decisión deliberada mientras el proyecto se mantiene como sitio web de uso personal/en pareja; no publiques la URL de tu implementación si quieres mantener los datos privados, y evalúa restaurar un control de acceso a nivel de red (por ejemplo, Workspace) antes de compartirla ampliamente.

Cada persona tiene su propia contraseña: el backend la guarda como `password_hash` (SHA-256 con una `salt` aleatoria por cuenta), nunca en texto plano, y la API jamás devuelve el hash ni la sal. No hay registro de información financiera en consola, trackers ni analítica de terceros.

| Síntoma | Comprobación |
| --- | --- |
| Funciona localmente, pero Ingresar/Registrarme falla en Vercel | Configura `VITE_APPS_SCRIPT_URL` en Production y vuelve a desplegar; el `.env` local no se publica. |
| `UNAUTHORIZED` (ingresar) | Correo o contraseña incorrectos; el mensaje no confirma si la cuenta existe. |
| `DUPLICATE_USER` | Ya existe una cuenta con ese correo en `Usuarios`; usa Ingresar en lugar de Registrarte. |
| `SERVER_NOT_CONFIGURED` | Configura `SPREADSHEET_ID` en Apps Script y despliega una nueva versión. |
| Respuesta HTML / error de red | Usa `/exec`, acceso “Cualquier usuario” y ejecuta como tu cuenta. Algunas políticas de Workspace restringen esa opción. |
| `SCHEMA_MISMATCH` | Restablece los encabezados y su orden. No renombres columnas existentes. |
| `CLOCK_SKEW` | Activa fecha y hora automáticas en el dispositivo y vuelve a sincronizar. |
| Cambios pendientes | Reabre con conexión o usa sincronización manual. Mantén el almacenamiento del navegador. |
| Datos no visibles tras cambiar conexión | Cada conexión tiene una caché separada; vuelve a la conexión anterior o usa importación local si esos registros nunca estuvieron conectados. |
| Íconos o recursos 404 | Vuelve a construir y actualiza la app instalada; la base ahora es siempre `/`. |
| PDF no comparte archivos | Descarga el PDF o usa los accesos de resumen en texto. La capacidad depende del navegador. |

## 7. Checklist de aceptación

Este estado separa código disponible de validación en servicios y dispositivos reales. Ninguna prueba local demuestra por sí sola instalación en iOS, entrega a Sheets en tres segundos o adjunto efectivo a WhatsApp.

| Criterio | Estado de entrega |
| --- | --- |
| PWA con manifest, íconos, standalone y safe areas | Implementado; instalación en iPhone real pendiente de comprobar |
| Captura rápida y sincronización en ≤3 s | Flujo implementado; tiempos objetivo pendientes de medir con tu Google Sheet y red |
| Captura offline, cola persistente y UUID idempotente | Implementado; prueba completa de reconexión contra Apps Script pendiente |
| Sueldos, ingresos extra, fijos y deuda en gráficas | Implementado; demo local explícito para revisar |
| Categorías, tags, edición y filtros | Implementado; escritura real requiere tu conexión |
| Ciclos, hormiga, repetidos, crecimiento y deuda | Implementado y cubierto por pruebas de analítica |
| Rachas correctas y pruebas unitarias | 24 pruebas de analítica ejecutadas correctamente |
| PDF local, descarga y Web Share con alternativas | Implementado; hoja nativa y adjuntos en iPhone pendientes de verificar |
| Tema claro y diseño adaptable a móvil, tablet y escritorio | Verificado en navegador de 320 a 1920 px; comprobación en dispositivos reales pendiente |
| Backend único con constantes requeridas | `backend/Code.gs`, sin archivos backend adicionales |
| Sin secretos en el repositorio | Sin tokens ni marcadores de credenciales; las cuentas se crean desde la app |
| Cuentas por correo/contraseña y atribución por `usuario_id` | Implementado en `Drip_API:V:0.0.0.03`, sin token de dispositivo; migración automática de hojas `V:0.0.0.01`/`V:0.0.0.02` |
| Interfaz responsiva en móvil y computador sin rediseño | Implementado con el marco centrado existente (`@media (min-width: 431px)`) |

Antes del uso diario, registra un gasto real pequeño, comprueba la fila en Sheets, edítalo, elimínalo, repite una captura en modo avión, recupera conexión y confirma que queda una sola fila por UUID. Después verifica un PDF y su adjunto desde la app instalada en el iPhone.
