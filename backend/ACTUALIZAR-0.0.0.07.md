# Actualización de Drip a la API 0.0.0.07

El código está en `backend/Code.gs`. El ID de la hoja y los nombres de las pestañas se conservan. Esta versión no requiere crear otra base de datos ni borrar registros.

1. Sustituye el contenido del archivo del proyecto de Apps Script por `backend/Code.gs` y guárdalo.
2. Ejecuta `setup()` para verificar los encabezados y las pestañas existentes.
3. En **Implementar → Gestionar implementaciones**, edita la implementación actual, selecciona **Nueva versión** e implementa. Conserva la misma URL `/exec` configurada en `VITE_APPS_SCRIPT_URL`.
4. Comprueba la URL `/exec`: la respuesta debe indicar `Drip_API:V:0.0.0.07`.
5. Despliega también el frontend actualizado. En cada dispositivo, acepta la actualización de la aplicación e ingresa con el mismo correo. Al ingresar se descarga el historial completo. Mientras la sesión permanezca abierta, usa **Actualizar** para consultar cambios de otro dispositivo.

## Contrato JSON

Todas las respuestas conservan el envoltorio `{ "ok": true, "data": ... }` o `{ "ok": false, "error": "CODIGO", "message": "..." }`.

- `list` incluye `apiVersion` y `syncProtocol: 1`, además del historial y todas las colecciones. `since` solo filtra movimientos; las demás colecciones son completas.
- `sync` recibe `operations` (hasta 250; el cliente envía lotes de 50) y `categorias: [{id,nombre}]` para resolver renombrados. Devuelve `{registros,serverTime,snapshot}`. La confirmación y la instantánea se generan bajo el mismo bloqueo.
- Las escrituras con `includeSnapshot: true` devuelven `{result,snapshot}`. `result` conserva la forma de la respuesta de la acción original.
- `createTeam` recibe `id`, `nombre`, `usuario_id` y `correos` (arreglo o cadena separada por comas). Los correos se validan antes de guardar; repetir el ID no crea otro equipo. `inviteToTeam` también acepta varios correos.
- `miembros` siempre es un arreglo único de IDs; incluye al creador. Los votos y comentarios se incluyen dentro de cada deseo.

## Comprobación con la cuenta real

1. En PC registra un gasto. Espera a que desaparezca el indicador de pendientes. En móvil ingresa con el mismo correo y verifica fecha, monto y descripción.
2. Edita ese movimiento en móvil. En PC pulsa **Actualizar** y comprueba el cambio y que exista una sola fila con ese ID en Sheets.
3. Registra un abono hoy: debe sumar una sola vez al gasto, reducir la deuda y dejar la racha sin gastos en cero.
4. Crea un equipo con dos correos registrados separados por una coma. Debe mostrar tres personas contando al creador; repetir un correo no aumenta el total.
5. Abre Agregar y Crear deuda en móvil y PC. El formulario debe empezar visible, desplazarse internamente y ocultar el footer hasta cerrar.
6. Sin internet, registra un movimiento y vuelve a conectar. Debe enviarse una vez; dejar la app quieta o cambiar de pestaña no debe generar consultas periódicas.

El objetivo de carga es de 20 segundos. Las peticiones tienen ese presupuesto y el backend evita lecturas repetidas dentro de una misma ejecución; el rendimiento real debe medirse en la implementación publicada. Una petición cancelada puede haber alcanzado el servidor: conserva el almacenamiento local y usa los reintentos con el mismo ID.

La versión conserva el modelo de identidad existente: los movimientos se muestran por `usuario_id` y los equipos por pertenencia. La sincronización completa recupera movimientos vivos con `usuario_id` que existan solo en la caché de esa misma conexión, aunque una versión anterior haya perdido su cola: los reenvía con su ID y propietario original. Los borrados lógicos del servidor prevalecen. Los registros históricos sin `usuario_id` no se atribuyen automáticamente a una persona; los datos de otra conexión tampoco se migran sin identificar su origen. Esta actualización no reasigna ni elimina esos datos.

## Validación local — 2 de octubre de 2026

- `npm test`: 138 pruebas aprobadas en 8 archivos. Incluyen cachés separadas para PC y móvil, recuperación de una cola perdida, respeto por los borrados lógicos, conservación del propietario, confirmaciones perdidas, escrituras durante una petición, correos múltiples y abonos que terminan la racha.
- `npm run build`: TypeScript, Vite y generación de la PWA completados. Permanece el aviso de tamaño del paquete de gráficas; no impide compilar.
- Interfaz local con datos demo: modal de gasto en 390 × 844; abono en 320 × 640; posición y dimensiones del modal en 1440 × 900. Se comprobó posición fija, desplazamiento interno y footer oculto al abrir el modal. Sin errores en la consola inspeccionada.
- Pendiente: publicar backend y frontend y verificar con la cuenta y red reales. Los tiempos de Google Apps Script y la igualdad de datos de producción no se certifican mediante estas pruebas locales.
