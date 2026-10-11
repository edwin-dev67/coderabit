# Prometheus Recover

Desofuscador de Prometheus para Lua 5.1. Combina recuperación estática de la VM,
descifrado de constantes, reconstrucción de flujo, informes por etapa y trazas
opcionales en un entorno aislado. Basado en el motor MIT de LeakD/prostone4;
ver [atribuciones y revisiones](THIRD_PARTY.md).

## Uso

Requiere **Node.js 22+**. No hay dependencias npm. Para validar el resultado
necesitas el compilador **Lua 5.1** (`luac5.1` o `luac51`; también se admite `luac`
si informa versión 5.1).

```bash
node bin/recover.js archivo.lua -o recovered/archivo
# Acepta también archivos .txt con código Lua.
node bin/recover.js archivo.txt -o recovered/archivo-txt --luac /ruta/a/luac5.1 --snapshots
```

El directorio de destino debe ser nuevo. No se sobrescriben resultados anteriores.
Usa `node bin/recover.js --help` para ver las opciones.

### Archivos de salida

- `recovered.lua`: resultado con sintaxis Lua 5.1 validada, sin advertencias del motor
  ni VM residual reconocida por el detector.
- `partial.lua`: resultado cuando falta validación, queda una VM reconocida, hay
  advertencias o se necesita la estrategia conservadora.
- `report.json`: SHA256 de entrada, tamaños, estrategia, métricas, advertencias,
  validación y URLs recuperadas. Las métricas son contadores del motor, no un
  porcentaje de exactitud.
- `strings.json`: cadenas del resultado; `base64` conserva los bytes exactos.
- `stages/`: código después de cada transformación, con `--snapshots`.
- `trace.json`: observaciones parciales, con `--trace`.

Códigos de salida: **0** recuperación y sintaxis comprobadas; **2** resultado
parcial, compilador ausente o traza incompleta; **1** error de entrada o análisis.
Una traza incompleta puede coexistir con `recovered.lua`: el estado del análisis
estático y el de la traza se informan por separado.

**Compilar no demuestra equivalencia de comportamiento.** Todos los informes
indican `semanticEquivalence: "not-verified"`. No se recuperan los nombres originales
que fueron borrados, ni se garantiza compatibilidad con cualquier fork de Prometheus.
El objetivo de salida es Lua 5.1; no se ofrece soporte completo del lenguaje Luau.

## Qué incorpora

- Parser y AST, evaluación acotada de constantes y descifrado de cadenas.
- Recuperación de bloques, funciones, closures y capas de virtualización.
- Reparación de las constantes ausentes en la limpieza de saltos del motor base.
- Conservación de saltos y etiquetas durante la limpieza de constantes.
- Restauración del AST y métricas si una transformación falla, con advertencia.
- Segunda estrategia con menos optimizaciones si la primera salida no compila.
- Validación mediante un compilador real, nunca ejecutando el resultado para validarlo.
- Análisis en un worker con límite de tiempo y memoria de V8; entrada de hasta 2 MiB.
- Observaciones dinámicas separadas del código recuperado, inspiradas en V2 y Dumper.

## Trazas opcionales

Requieren **Linux**, `bwrap` (bubblewrap), `prlimit` y un intérprete **Lua 5.1**.
El sistema debe permitir los namespaces utilizados por bubblewrap.

```bash
node bin/recover.js archivo.lua -o recovered/con-traza \
  --luac /ruta/a/luac5.1 --trace --lua /ruta/a/lua5.1
```

La entrada original se observa en un proceso sin red, con entorno vacío y sin
acceso al checkout o al directorio del usuario. Se montan las bibliotecas del
sistema y los tres archivos necesarios en modo lectura. Se aplican límites de
memoria (256 MiB de espacio de direcciones), CPU, tiempo y eventos. Si no se puede
crear el aislamiento, se informa como no disponible; no hay ejecución alternativa
sin aislamiento.

El entorno simula llamadas Roblox. No ejecuta callbacks diferidos ni descarga
bibliotecas HTTP. `loadstring` registra la cadena y devuelve un objeto simulado.
Las trazas pueden fallar por anti-tamper o por un API no simulado. No son una
reconstrucción completa y no reemplazan el resultado estático.

## API Node.js

```js
const fs = require('node:fs');
const { deobfuscate } = require('./src');

async function main() {
  const result = await deobfuscate(fs.readFileSync('archivo.lua'), {
    luac: '/ruta/a/luac5.1',
    timeoutMs: 30000, // por intento; máximo 300000
    snapshots: true,
  });
  console.log(result.report);
}
main().catch(console.error);
```

Usa `Buffer` para conservar bytes Lua que no sean UTF-8. Los strings de entrada
se interpretan como Latin-1. La API devuelve también salidas parciales; consulta
siempre `report.status`. `force: true` permite analizar Lua sin la firma de Prometheus.

## Pruebas

```bash
LUA51=/ruta/a/lua5.1 LUAC51=/ruta/a/luac5.1 npm test
# Incluye la muestra local del usuario, sin incorporarla al repositorio:
LUA51=/ruta/a/lua5.1 LUAC51=/ruta/a/luac5.1 \
  PROMETHEUS_SAMPLE=/ruta/a/1CutGrassAdventure.txt npm test
```

La suite requiere también bubblewrap y prlimit para las pruebas de aislamiento.
Compara el original conocido, su versión ofuscada y la recuperación en seis casos:
Weak/Medium/Strong con semillas 17/42. Cubre closures, estado compartido, ramas,
bucles, retornos múltiples con nil, bytes, recursión, metatables y orden de efectos.
Comprueba además rollback, límites, validación, trazas y protección de resultados.

Para regenerar fixtures, usa el checkout y revisión de Prometheus indicados en
`THIRD_PARTY.md`:

```bash
PROMETHEUS_ROOT=/ruta/a/Prometheus /ruta/a/lua5.1 scripts/generate-fixtures.lua
```

Las semillas controlan la generación, pero el runtime y la iteración de tablas
pueden cambiar los bytes emitidos. Los fixtures versionados fijan las entradas
exactas de la regresión.

## Resultado con la muestra Cut Grass Adventure

El motor original emitía código que no compilaba. Esta versión recupera el flujo
sin `goto`, incluidas las funciones `Best`, `Strength` y `Rebirth`, y pasa la
comprobación de sintaxis de Lua 5.1. La equivalencia dentro de Roblox queda sin
verificar: no hay fuente original ni fixtures del juego.
