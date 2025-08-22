Problema: “Park&Charge – Red de recarga con créditos y WETH”
Contexto

Una ciudad lanza Park&Charge, una red de estacionamiento + recarga de vehículos eléctricos. Los usuarios pueden:

Pagar sesiones de recarga directamente con WETH (no se acepta ETH nativo), o

Comprar y gastar CRED (un token ERC-20 propio de la red) que da descuentos y permite bonificaciones.

La ciudad quiere operar con contabilidad clara, pagos atómicos y reembolsos trazables. Además, busca evitar depósitos “ciegos” de tokens al contrato.

Entidades del sistema

Usuario: persona que aparca y recarga.

Operador: entidad que mantiene la red (tesorería).

Estaciones: lógicamente representadas por IDs dentro del sistema (no son contratos separados).

Token CRED (ERC-20): crédito utilitario de Park&Charge.

WETH: envoltorio 1:1 de ETH; solo se acepta WETH (no ETH).

Contratos a implementar (exactamente dos)
1) CREDToken (ERC-20)

Token utilitario con:

Suministro (supply): definido por el Operador. Requisitos:

Puede ser mixto: parte fija inicial y parte dinámica (mint/burn) según reglas de negocio.

Implementa _mint y _burn (con eventos Transfer apropiados).

Decimales: 18.

Permisos (RBAC simple o equivalente):

MINTER_ROLE: puede mintear para promociones/bonos.

BURNER_ROLE (opcional si no se permite burn arbitrario): la lógica de gastos podrá invocar burn bajo condiciones.

PAUSER_ROLE (opcional): para pausar transferencias ante incidentes.

Allowances: flujo clásico approve/transferFrom + helpers (increaseAllowance/decreaseAllowance).

permit (EIP-2612): deseable para UX (aprobaciones vía firma).

Eventos obligatorios: Transfer, Approval.
Extras recomendados: Minted(to, amount), Burned(from, amount), Paused/Unpaused si aplica.

Este contrato no maneja WETH ni cobros. Solo gestiona saldos de CRED, supply y permisos.

2) ParkAndCharge (Marketplace de servicios)

Orquesta cobros y reglas de negocio. Debe:

Aceptar pagos solo en WETH o en CRED:

Al pagar con WETH: el contrato cobra vía transferFrom (requiere approve o permit en WETH si disponible).

Al pagar con CRED: quema CRED del usuario (burn/transferFrom seguido de burn) con descuento aplicado.

Tarifas & descuentos:

Precio base por sesión (o por kWh simulado), en WETH.

Descuento si el usuario paga en CRED (p. ej., -10% respecto al precio WETH).

Comisión operativa p. ej. 2% sobre WETH cobrado (va a Tesorería).

Gestión de sesiones:

startSession(stationId, …): reserva/abre sesión (si se cobra por anticipado, cobrar aquí).

endSession(sessionId, meterData): cierra sesión, calcula coste final y liquida la diferencia (si hubo prepago).

Reembolsos:

Si la sesión se cancela o consume menos de lo prepagado, reembolsar al usuario en el mismo activo (WETH o CRED) usando saldos del contrato o lógica de reversión controlada.

Allowance vs. depósitos ciegos:

Prohibido aceptar “transferencias directas” como pago. El flujo correcto es:

Usuario autoriza (approve/permit)

Contrato cobra con transferFrom dentro de su función (atomicidad y conocimiento del resultado).

Tesorería:

Dirección configurable (por Operador/Tesorero).

Opción de acumular WETH y retirar a tesorería.

Si se desea, permitir unwrap a ETH internamente (usando WETH.withdraw) solo al retirar a tesorería.

Roles:

ADMIN: configura tarifas globales, descuentos, WETH/CRED addresses, tesorería.

OPERATOR: puede pausar estaciones, cerrar sesiones atascadas, disparar reembolsos autorizados.

TREASURER: puede retirar fondos a tesorería (WETH o ETH si se hace unwrap).

Pausas y seguridad:

pause()/unpause() de operaciones críticas.

Guardas anti-reentrancia en cobros y retiros.

Eventos obligatorios:

SessionStarted(user, stationId, prepayAsset, prepayAmount)

SessionEnded(user, sessionId, finalAsset, finalCharge, refundAsset, refundAmount)

PaidInWETH(user, gross, fee, netToOperator)

PaidInCRED(user, grossCRED, discountApplied)

TreasuryUpdated(old, new), RatesUpdated(...), WithdrawnToTreasury(asset, amount)

Paused, Unpaused, y cualquier cambio relevante de config.

Este contrato sí interactúa con WETH y con CREDToken mediante transferFrom, permit (si procede), y burn/mint cuando corresponda.

Flujos que debes soportar (casuística rica)

Compra prepago con WETH

Usuario autoriza a ParkAndCharge a gastar x WETH (approve o permit).

Llama startSession con payIn=WETH y quantía estimada.

El contrato cobra transferFrom(user → contrato, x) y emite PaidInWETH.

Se marca la sesión “abierta”.

Compra prepago con CRED (con descuento)

Usuario autoriza CRED al contrato (approve o permit del token).

Llama startSession con payIn=CRED.

El contrato quema los CRED correspondientes (o los toma con transferFrom y luego los quema).

Emite PaidInCRED indicando descuento aplicado.

Cierre de sesión con ajuste

endSession(sessionId, meterData).

Si sobró prepago: reembolso en el mismo activo.

Si faltó: cobrar diferencia (requiere que el usuario tenga allowance suficiente o usar “top-up” previo).

Emite SessionEnded con desglose (finalCharge, refunds).

Pago puntual sin prepago (solo WETH)

Usuario llama payNow(stationId, exactAmount, WETH) con approve/permit dado.

El contrato cobra transferFrom y emite PaidInWETH.

Útil para estacionamiento sin medición.

Bonificaciones en CRED (promos)

Operador mintea CRED a usuarios (airdrops, recompensas de fidelidad).

Los usuarios después pueden pagar con CRED con descuento.

Reembolso total/Parcial por falla

Operador ejecuta refund(sessionId, asset, amount) siguiendo políticas, reembolsa en WETH o CRED según el caso.

Cambio de tesorería y retiros

setTreasury(newTreasury) por TREASURER; emite TreasuryUpdated.

withdrawToTreasury(WETH) transfiere WETH acumulado; opcionalmente unwrapAndWithdrawETH(amount).

Pausa de emergencia

pause() bloquea nuevas sesiones y cobros, permite quizá solo reembolsos.

unpause() reanuda.

Reglas de negocio y detalles numéricos

Decimales:

CRED: 18.

WETH: 18 (igual que ETH).

Precios base: expresados y almacenados en WETH base units (wei).

Descuento CRED: p. ej., 10% (configurable).

Fee operador: p. ej., 2% sobre cobros en WETH (separado internamente y líquido a tesorería).

Invariantes:

No aceptar pagos sin transferFrom (evitar depósitos ciegos).

En pagos CRED: si hay burn, reflejarlo siempre con Transfer(to=0x0) (vía _burn).

En pagos WETH: contabilizar fee y neto; el usuario paga mientras se ejecuta la lógica (atomicidad).

Reembolsos siempre en el activo de entrada (evita riesgos cambiarios).

Casos límite (deben cubrirse)

Allowance insuficiente (WETH o CRED) → revertir con mensaje claro.

Saldo insuficiente → revertir.

permit expirado o firma inválida → revertir.

Reembolso que excede lo cobrado → revertir.

Cambios de config en medio de una sesión → documentar comportamiento (aplicar precios de inicio o de cierre, pero ser consistente).

Pausado: bloquear inicios de sesión/pagos; permitir retiros del operador y/o reembolsos si se decide así.

Estaciones no registradas o bloqueadas → revertir.

Top-up para cubrir diferenciales cuando endSession supera el prepago.

Seguridad y mejores prácticas (obligatorio)

Patrón checks-effects-interactions y anti-reentrancia en las rutas de cobro/reembolso.

Eventos exhaustivos para auditoría y UX (pagos, sesiones, retiros, cambios de config).

RBAC: solo roles correctos pueden cambiar tarifas, tesorería, pausar, mintear/quemar.

Sin ETH directo: si se recibe ETH por error (fallback), registrarlo y permitir retiro a tesorería; no usarlo como pago (regla del problema).

Pruebas con approve y con permit (cuando el token/WETH lo soporte), incluyendo expiración y nonces.

Qué debe poder probar un juez/QA (sin ver código)

Mint inicial de CRED, airdrop a usuarios, y descuentos activos.

Pago con WETH: approve/permit → startSession → endSession con exceso/defecto → reembolso o cargo adicional.

Pago con CRED: approve/permit → burn correcto y descuento aplicado.

Reembolsos exactos en el mismo activo.

Pausa y despausa bloqueando/permitiendo acciones.

Retiros a tesorería y (opcional) unwrap correcto.

Eventos: presencia, parámetros, y orden.

Errores bien explicados (mensajes de revert útiles).

Entregables esperados (para el enunciado)

Especificación técnica de ambos contratos (interfaces externas, eventos, errores).

Tabla de parámetros (precios, descuento, fee, límites).

Diagrama de flujos (texto/ASCII o explicación clara) para los 8 flujos.

Matriz de pruebas (caso → pasos → resultado esperado → eventos).

Lista de invariantes y cómo se validan en tests.

Nota sobre WETH

Se configurará la dirección de WETH según la red (Hardhat local, testnet).

No se aceptará ETH directo como pago: el usuario debe wrappear o usar WETH que ya tenga, y autorizar al contrato.

Objetivo pedagógico

Este enunciado obliga a ejercitar:

ERC-20 completo: totalSupply/balanceOf, transfer, approve/transferFrom, increase/decreaseAllowance, _mint/_burn, eventos, decimales, y (opcional) permit.

Interacción entre contratos: marketplace que cobra con allowances y quema tokens utilitarios.

WETH como rail de pago y puente con ETH.

RBAC, pausas, reembolsos, fees, auditoría por eventos.

Atomicidad y seguridad (sin depósitos ciegos, sin doble gasto, revert apropiado).