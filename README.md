# wrapped-erc20-launpad
This is a project for proof of work


1) La idea general (el “problema” a resolver)

Quieres construir un pequeño sistema on-chain que permita envolver (wrap) tokens ERC-20 existentes y lanzar (deploy) nuevos “wrappers” de forma ordenada, con comisiones en los depósitos y gobernanza por roles.
Para entenderlo, piensa en WETH9: toma ETH nativo y te da WETH (un ERC-20) 1:1. Aquí la idea es similar, pero envolviendo un ERC-20 en otro ERC-20 “envuelto” (wrapped).

Ese sistema tiene dos piezas:

ERC20Wrapped: el “wrapper” de un token subyacente.

WrapperFactory: una “fábrica” que lanza nuevos wrappers y define reglas globales (quién cobra comisiones, cuánto es la comisión, etc.).

El resultado: cualquier persona puede depositar el token subyacente y recibir su versión envuelta; y también retirarla cuando quiera (devolviendo el token envuelto y recibiendo el subyacente).

2) Conceptos base (cinco que debes tener clarísimos)

ERC-20: estándar de tokens (saldos, transferencias, approvals).

WETH9 (referencia mental): ejemplo clásico de “envolver”: depositas ETH → recibes WETH; devuelves WETH → recibes ETH.

Wrap/Unwrap: “Guardar” el activo original en el contrato y recibir un recibo (el token envuelto) que representa ese depósito y es transferible.

Fee en depósito: al depositar, se descuenta un porcentaje que va a un receptor de comisiones.

EIP-2612 (permit): forma de autorizar (dar allowance) con una firma fuera de cadena; evita que el usuario tenga que hacer dos transacciones (approve + deposit). Si el token subyacente lo soporta, el depósito puede ser más fluido.

3) ¿Qué hace ERC20Wrapped?

Es el contrato que recibe el token subyacente y emite (acuña) el token envuelto. También hace el proceso inverso al retirar.

Parámetros cuando se despliega (quedan grabados):

Subyacente: el ERC-20 que vas a envolver.

Fee en depósito: el porcentaje que se cobrará cada vez que alguien deposite (este no cambia para ese wrapper).

Factory: la dirección de la fábrica. Se usa para preguntar a quién enviar la comisión (el receptor puede cambiarse en la fábrica, y cada depósito “pregunta” a la fábrica el receptor vigente).

Depósito (wrap):

El usuario entrega el subyacente.

Se calcula la comisión y se envía al receptor que diga la fábrica en ese momento.

El wrapper conserva el resto como reserva y emite tokens envueltos al usuario.

Si el subyacente soporta EIP-2612 (permit), el usuario puede autorizar el movimiento con firma (sin hacer un approve previo); si no lo soporta, debe autorizar del modo clásico (approve → deposit).

Retiro (unwrap):

El usuario retorna sus tokens envueltos.

El wrapper quema esos tokens y le devuelve el subyacente desde su reserva.

(La especificación solo exige fee en depósito; típicamente no se cobra fee al retirar).

Invariante mental importante:
Para que el sistema sea “sano”, el wrapper debe mantener una relación clara entre:

Suministro total del token envuelto, y

Reservas de subyacente en el contrato.

La forma intuitiva (y más fácil de razonar) es:

“1 token envuelto ≈ 1 token subyacente en reserva”
Si hay fee al depositar, lo natural es que el usuario reciba menos tokens envueltos que lo depositado, porque una parte se fue como comisión. Así, el suministro de envueltos coincide con la reserva real que respalda esos envueltos, y siempre puedes devolver 1 envuelto por 1 subyacente.

4) ¿Qué hace WrapperFactory?

Es la fábrica que lanza nuevos wrappers y define políticas.

Actualizable: la fábrica debe poder evolucionar (por ejemplo, corregir bugs o añadir funciones), sin romper los wrappers ya creados.

Roles:

Administrator: gestiona quién es Operator y Treasurer.

Treasurer: puede cambiar el receptor de comisiones (a dónde va el fee).

Operator: puede cambiar la tasa de fee para futuros wrappers (no afecta a los ya desplegados).

Receptor de comisiones: una dirección única que la fábrica publica; los wrappers le preguntan en cada depósito y allí envían la comisión.

Fee en depósito: un número global que la fábrica usa al crear un wrapper; ese número queda congelado en ese wrapper concreto.

Despliegue de wrappers: cualquiera puede pedir a la fábrica que cree un wrapper para un token subyacente dado.

Unicidad: si ya existe un wrapper para ese subyacente, debe fallar (evitas duplicados confusos).

5) Flujos explicados con ejemplos (sin código)
Flujo 1: Configuración inicial de la fábrica

El equipo de la plataforma despliega la fábrica.

Asigna roles:

Administrator al equipo de devops/gobernanza.

Treasurer al área financiera (para poder cambiar el receptor de comisiones).

Operator al equipo que decide políticas de negocio (para ajustar la tasa de fee de futuros wrappers).

Fijan un receptor de comisiones (por ejemplo, una tesorería multisig).

Definen una tasa global de fee (p. ej., 1%).

Resultado: la “empresa” ya puede lanzar wrappers con una política centralizada de comisiones y un destino de esas comisiones que puede variar en el tiempo.

Flujo 2: Lanzar un nuevo wrapper para un token X

Un usuario (o el propio equipo) llama a la fábrica para crear el wrapper del token X.

La fábrica:

Verifica que no exista ya un wrapper de X.

Crea el nuevo ERC20Wrapped(X) con: subyacente = X, fee = la tasa global vigente ahora, y la dirección de la fábrica almacenada dentro del wrapper.

A partir de este punto, cualquiera puede depositar X y recibir wX (el token envuelto de X) en ese wrapper.

Nota: si mañana el Operator sube la tasa global a 1.5%, no afecta al wrapper de X ya creado; afectará a los próximos wrappers que lance la fábrica.

Flujo 3: Depósito (wrap) con aprobación clásica

Supón que la fábrica fijó fee = 1%, y ya existe el wrapper de X.

María quiere envolver 100 X.

Como X no soporta permit, primero hace la autorización clásica (approve) para que el wrapper pueda mover sus X.

María inicia el depósito de 100 X:

El wrapper recibe 100 X, calcula la comisión: 1% de 100 = 1 X.

Consulta a la fábrica: “¿Quién es hoy el receptor de comisiones?” → Por ejemplo, Tesorería.

Envía 1 X a Tesorería.

Conserva 99 X como reserva.

Emite 99 wX a María.

Invariante tras la operación:

Suministro de wX en circulación: 99.

Reserva de X en el wrapper: 99.

Conclusión: 1 wX ↔ 1 X (perfecto).

Flujo 4: Depósito (wrap) con permit (EIP-2612)

Ahora supón que X sí soporta permit.

Juan quiere envolver 200 X.

Juan firma fuera de cadena la autorización (no paga gas por esa firma).

Al iniciar el depósito, el wrapper (o el flujo del dApp) usa esa firma para obtener permiso en la misma transacción y mover los 200 X.

Con fee 1%:

Comisión: 2 X → va al receptor actual de la fábrica.

Reserva: 198 X.

Emisión: 198 wX.

Resultado: Juan hizo un solo flujo de depósito (mejor UX).

Flujo 5: Retiro (unwrap)

Ana tiene 50 wX y quiere volver a X.

Ana entrega 50 wX al wrapper.

El wrapper quema esos 50 wX y le devuelve 50 X desde la reserva.

El suministro de wX disminuye, y la reserva también, manteniendo la equivalencia 1:1.

Flujo 6: Cambiar el receptor de comisiones

La tesorería cambia de organización/billetera.

El rol Treasurer llama a la fábrica y actualiza el fee receiver (nuevo destinatario de comisiones).

Desde ese momento, todos los wrappers, en cada depósito, preguntan a la fábrica y envían la comisión al nuevo receptor (los wrappers no necesitan redeploy).

Flujo 7: Subir la tasa de fee para futuros wrappers

El área de negocio decide pasar de 1% a 1.5%.

El rol Operator actualiza en la fábrica la tasa global.

Los wrappers ya creados no cambian su fee; solo los nuevos wrappers usarán 1.5%.

6) Riesgos y criterios de seguridad (visión de profe)

No pérdida de fondos:

El wrapper debe mantener reservas para respaldar el suministro de envueltos.

El fee reduce lo que el usuario recibe en envueltos (o su poder de redención), para no “descalzar” reservas vs. suministro.

Prevención de abuso:

Cualquiera puede depositar/retirar, pero nadie puede “drenar” reservas sin devolver envueltos.

Los cambios de receptor y de tasa global están limitados por roles.

Compatibilidad ERC-20:

El diseño asume tokens ERC-20 estándar. Si el subyacente es “deflacionario” (cobra su propio fee al transferir), la contabilidad se complica: tú pides 100, pero recibes 98. Este test no menciona esos tokens con “fee-on-transfer”; en un sistema real, hay que decidir cómo tratarlos.

Upgradeabilidad (solo la fábrica):

Permite mejorar el sistema con el tiempo.

Experiencia de usuario:

Con permit (cuando existe), los depósitos son más sencillos (menos pasos, mejor UX).

7) Resumen mental (para que te lo lleves claro)

Wrapper = caja fuerte que guarda el subyacente y entrega un recibo transferible (token envuelto) que puedes cambiar de vuelta cuando quieras.

Fábrica = oficina central que lanza esas cajas fuertes con reglas consistentes (misma política de comisión, mismo receptor de fees configurable por roles).

Fee: se cobra en el depósito y se envía en ese momento al receptor que la fábrica indique.

Permit: mejora UX reduciendo pasos (si el subyacente lo soporta).

Invariante sana: idealmente, 1 token envuelto ↔ 1 token subyacente en reserva (ajustado por comisiones en el momento del depósito).