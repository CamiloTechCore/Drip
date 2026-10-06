# Liquidez acumulada y aportes a deseos

Reemplazar el contenido del proyecto Apps Script por Code.gs y actualizar la implementación web existente. Publicar también el frontend compilado. El backend conserva la versión y el protocolo compatibles con 0.0.0.07; agrega la acción contributeWish sin nuevas pestañas.

- Inicio calcula liquidez con todo el historial del usuario, incluidos ingresos adicionales, gastos, pagos de deuda y transferencias de ahorro. Los filtros del análisis no modifican ese saldo.
- Cada miembro debe aprobar el deseo antes de aportar. Las cuotas se reparten por participante, incluido el creador; los centavos sobrantes se asignan en orden de ID.
- Un invitado registra gasto por su aporte y el creador recibe un ingreso por el mismo valor. El primer aporte del creador registra un único gasto por el presupuesto completo. No debe registrarse manualmente otra vez.
- Los aportes admiten pagos parciales hasta la cuota individual. Los identificadores de operación previenen duplicados; los movimientos generados se protegen de edición y eliminación genéricas.
- Los registros internos sin_gasto con prefijo wish-contribution- son comprobantes de aportes, no confirmaciones personales de días sin gasto, y no se muestran como movimientos personales. El progreso se reconstruye a partir de esos comprobantes.
- No se pueden añadir participantes a un Team con aportes: cambiaría las cuotas ya cobradas. Puede crearse otro Team.
- Las carteras antiguas y los deseos con progreso histórico no se convierten automáticamente en movimientos: no hay datos suficientes para atribuir sus aportes. Revisarlos antes de utilizar el nuevo flujo.
- La demo queda desactivada incluso si el dispositivo conservaba la preferencia anterior.

## Categorías sin presupuesto y eliminación de deseos

Se retira el presupuesto del editor, de la lista de categorías y del análisis mensual. La columna presupuesto_mensual se conserva por compatibilidad con hojas existentes, pero los guardados nuevos la fijan en cero.

La acción deleteWish permite al creador del deseo o al creador del Team marcarlo como eliminado, incluso si ya recibió aportes. Los votos, comentarios y movimientos se conservan para auditoría; no se generan devoluciones ni cambia la liquidez. Ya no permite aportes o votos posteriores. Publicar backend y frontend juntos para habilitar el botón.
